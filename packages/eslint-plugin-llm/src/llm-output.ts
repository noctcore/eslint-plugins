import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/*
 * Where LLM output comes from, and how far it can be followed without types.
 *
 * A source is the awaited result of a recognised SDK call. It is not yet text:
 * `res` is a response object, and only a few paths inside it carry what the
 * model wrote (`res.choices[0].message.content`). So a value is tracked as a
 * SHAPE (the response, or part of it, with the paths still leading to model
 * text) until one of those paths is fully walked, and then as OUTPUT (the
 * model's text or object itself). Everything the analysis cannot see through
 * yields null, and null never reports.
 */

/** Any array slot: `[0]`, `[i]`, `.at(0)`, `.find(...)`, an array-pattern element. */
export const ELEMENT = Symbol('element');

type Segment = string | typeof ELEMENT;
type Path = readonly Segment[];

export type Flow =
  | { readonly kind: 'output'; readonly source: string }
  | { readonly kind: 'shape'; readonly source: string; readonly paths: readonly Path[] };

interface SourceSpec {
  /** How the report names the source. */
  readonly label: string;
  /** Paths from the awaited result to the model-written value. */
  readonly paths: readonly Path[];
}

const OPENAI_CHAT: SourceSpec = {
  label: 'an OpenAI chat completion',
  paths: [['choices', ELEMENT, 'message', 'content']],
};
const OPENAI_RESPONSE: SourceSpec = {
  label: 'an OpenAI response',
  paths: [['output_text']],
};
// A `tool_use` block's `input` is the model's chosen arguments, as untrusted as its prose.
const ANTHROPIC_MESSAGE: SourceSpec = {
  label: 'an Anthropic message',
  paths: [
    ['content', ELEMENT, 'text'],
    ['content', ELEMENT, 'input'],
  ],
};

/**
 * SDK calls recognised by the trailing property names of the callee. A
 * receiver must precede them (`openai.chat.completions.create`,
 * `this.client.messages.create`), so a bare `messages.create()` is not one.
 */
const METHOD_SOURCES: readonly { readonly suffix: readonly string[]; readonly spec: SourceSpec }[] = [
  { suffix: ['chat', 'completions', 'create'], spec: OPENAI_CHAT },
  { suffix: ['chat', 'completions', 'parse'], spec: OPENAI_CHAT },
  { suffix: ['responses', 'create'], spec: OPENAI_RESPONSE },
  { suffix: ['messages', 'create'], spec: ANTHROPIC_MESSAGE },
];

/** Vercel AI SDK functions, recognised only when imported from `ai`. */
const AI_SDK_MODULE = 'ai';
const AI_SDK_SOURCES: ReadonlyMap<string, SourceSpec> = new Map([
  ['generateText', { label: 'AI SDK `generateText`', paths: [['text']] }],
  ['generateObject', { label: 'AI SDK `generateObject`', paths: [['object']] }],
]);

/** Array methods that pick one element out of an array-shaped value. */
const ELEMENT_METHODS: ReadonlySet<string> = new Set(['at', 'find', 'findLast']);
/** Array methods that return a subset of the same array. */
const SUBSET_METHODS: ReadonlySet<string> = new Set(['filter']);
/**
 * String methods whose result is still the model's text. Deliberately short:
 * anything else (`replace`, a sanitizer, `schema.parse`) ends the flow.
 */
const PASS_THROUGH_METHODS: ReadonlySet<string> = new Set([
  'toLowerCase',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);

const MAX_DEPTH = 12;

/** Strips the TS-only wrappers that do not change a value. */
export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.ChainExpression
  ) {
    current = current.expression;
  }
  return current;
}

/** The name of `.name` / `['name']`, or null for a computed or private key. */
export function staticPropertyName(node: TSESTree.MemberExpression): string | null {
  if (!node.computed) {
    return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : null;
  }
  return node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === 'string'
    ? node.property.value
    : null;
}

function segmentOf(node: TSESTree.MemberExpression): Segment | null {
  const name = staticPropertyName(node);
  if (name !== null) {
    return name;
  }
  // Any other computed key is an index: `[0]`, `[i]`, `[choices.length - 1]`.
  return node.computed ? ELEMENT : null;
}

function propertyKeyName(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  return property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string'
    ? property.key.value
    : null;
}

function step(flow: Flow | null, segment: Segment): Flow | null {
  if (flow === null || flow.kind === 'output') {
    return flow;
  }
  const rest = flow.paths.filter((path) => path[0] === segment).map((path) => path.slice(1));
  if (rest.length === 0) {
    return null;
  }
  if (rest.some((path) => path.length === 0)) {
    return { kind: 'output', source: flow.source };
  }
  return { kind: 'shape', source: flow.source, paths: rest };
}

function expectsElement(flow: Flow | null): boolean {
  return flow?.kind === 'shape' && flow.paths.some((path) => path[0] === ELEMENT);
}

/** Output wins over shape, shape over nothing: `content ?? ''` is still the model's text. */
function either(left: Flow | null, right: Flow | null): Flow | null {
  if (left?.kind === 'output') return left;
  if (right?.kind === 'output') return right;
  return left ?? right;
}

/** A module a value came from, and the member path inside it (`fs` + `['promises', 'readFile']`). */
export interface ModuleMember {
  readonly module: string;
  readonly path: readonly string[];
}

function normalizeModule(specifier: string): ModuleMember {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  // `fs/promises` is `fs.promises`, so one method table covers both spellings.
  if (bare === 'fs/promises') {
    return { module: 'fs', path: ['promises'] };
  }
  return { module: bare, path: [] };
}

function requireSpecifier(node: TSESTree.Node): string | null {
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'require' &&
    node.arguments.length === 1
  ) {
    const [argument] = node.arguments;
    if (argument?.type === AST_NODE_TYPES.Literal && typeof argument.value === 'string') {
      return argument.value;
    }
  }
  return null;
}

function isPromisify(callee: TSESTree.Node): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'promisify';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    staticPropertyName(callee) === 'promisify' &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'util'
  );
}

function withPath(member: ModuleMember | null, extra: readonly string[]): ModuleMember | null {
  return member === null ? null : { module: member.module, path: [...member.path, ...extra] };
}

export interface Analysis {
  /** The flow of LLM output into this expression, or null when none is visible. */
  readonly flowOf: (node: TSESTree.Node) => Flow | null;
  /** The module member an expression is bound to (`import`, `require`, `promisify`), or null. */
  readonly moduleMemberOf: (node: TSESTree.Node) => ModuleMember | null;
  /** True when an identifier is not declared anywhere in the file (a global). */
  readonly isGlobal: (node: TSESTree.Identifier) => boolean;
  /** The initializer of a single `const` binding, or null. */
  readonly constInit: (node: TSESTree.Identifier) => TSESTree.Expression | null;
}

export function createAnalysis(sourceCode: Readonly<TSESLint.SourceCode>): Analysis {
  const bindingFlows = new Map<TSESTree.Identifier, Flow | null>();

  function variableOf(node: TSESTree.Identifier): TSESLint.Scope.Variable | null {
    return ASTUtils.findVariable(sourceCode.getScope(node), node) ?? null;
  }

  function isGlobal(node: TSESTree.Identifier): boolean {
    const variable = variableOf(node);
    return variable === null || variable.defs.length === 0;
  }

  /** The single `const` definition of an identifier, or null for anything reassignable. */
  function constDefinition(node: TSESTree.Identifier): TSESLint.Scope.Definition | null {
    const variable = variableOf(node);
    const def = variable?.defs[0];
    if (
      variable === null ||
      variable.defs.length !== 1 ||
      def === undefined ||
      def.type !== 'Variable' ||
      def.parent.kind !== 'const'
    ) {
      return null;
    }
    return def;
  }

  function constInit(node: TSESTree.Identifier): TSESTree.Expression | null {
    const def = constDefinition(node);
    if (def === null || def.type !== 'Variable' || def.node.id.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    return def.node.init;
  }

  function moduleMemberOf(raw: TSESTree.Node, depth = 0): ModuleMember | null {
    if (depth > MAX_DEPTH) {
      return null;
    }
    const node = unwrap(raw);
    if (node.type === AST_NODE_TYPES.MemberExpression) {
      const name = staticPropertyName(node);
      return name === null ? null : withPath(moduleMemberOf(node.object, depth + 1), [name]);
    }
    if (node.type === AST_NODE_TYPES.CallExpression) {
      const specifier = requireSpecifier(node);
      if (specifier !== null) {
        return normalizeModule(specifier);
      }
      // `const run = promisify(exec)` is still `exec`, now returning a promise.
      const [argument] = node.arguments;
      if (isPromisify(node.callee) && node.arguments.length === 1 && argument !== undefined) {
        return moduleMemberOf(argument, depth + 1);
      }
      return null;
    }
    if (node.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    const variable = variableOf(node);
    const def = variable?.defs[0];
    if (variable === null || variable.defs.length !== 1 || def === undefined) {
      return null;
    }
    if (def.type === 'ImportBinding') {
      if (def.parent.type !== AST_NODE_TYPES.ImportDeclaration) {
        return null;
      }
      const base = normalizeModule(def.parent.source.value);
      if (def.node.type !== AST_NODE_TYPES.ImportSpecifier) {
        // Namespace and default imports stand for the module itself.
        return base;
      }
      const imported =
        def.node.imported.type === AST_NODE_TYPES.Identifier
          ? def.node.imported.name
          : String(def.node.imported.value);
      return withPath(base, [imported]);
    }
    if (def.type !== 'Variable' || def.parent.kind !== 'const' || def.node.init === null) {
      return null;
    }
    const init = moduleMemberOf(def.node.init, depth + 1);
    return init === null ? null : projectKeys(init, def.node.id, def.name);
  }

  /** `const { exec } = require('child_process')`: the key path to `target` inside the pattern. */
  function patternKeys(pattern: TSESTree.Node, target: TSESTree.Identifier): string[] | null {
    if (pattern === target) {
      return [];
    }
    if (pattern.type === AST_NODE_TYPES.AssignmentPattern) {
      return patternKeys(pattern.left, target);
    }
    if (pattern.type !== AST_NODE_TYPES.ObjectPattern) {
      return null;
    }
    for (const property of pattern.properties) {
      if (property.type !== AST_NODE_TYPES.Property) {
        continue;
      }
      const inner = patternKeys(property.value, target);
      if (inner !== null) {
        const key = propertyKeyName(property);
        return key === null ? null : [key, ...inner];
      }
    }
    return null;
  }

  function projectKeys(
    member: ModuleMember,
    pattern: TSESTree.Node,
    target: TSESTree.Identifier,
  ): ModuleMember | null {
    const keys = patternKeys(pattern, target);
    return keys === null ? null : withPath(member, keys);
  }

  /** The SDK source an awaited call is, or null. */
  function sourceCall(raw: TSESTree.Node): SourceSpec | null {
    const node = unwrap(raw);
    if (node.type !== AST_NODE_TYPES.CallExpression) {
      return null;
    }
    const names: string[] = [];
    let callee: TSESTree.Node = unwrap(node.callee);
    while (callee.type === AST_NODE_TYPES.MemberExpression) {
      const name = staticPropertyName(callee);
      if (name === null) {
        break;
      }
      names.unshift(name);
      callee = unwrap(callee.object);
    }
    for (const { suffix, spec } of METHOD_SOURCES) {
      if (
        names.length >= suffix.length &&
        suffix.every((name, index) => names[names.length - suffix.length + index] === name)
      ) {
        return spec;
      }
    }
    const member = moduleMemberOf(node.callee);
    if (member?.module === AI_SDK_MODULE && member.path.length === 1) {
      return AI_SDK_SOURCES.get(member.path[0] ?? '') ?? null;
    }
    return null;
  }

  function bindingFlow(node: TSESTree.Identifier, depth: number): Flow | null {
    const def = constDefinition(node);
    if (def === null || def.type !== 'Variable') {
      return null;
    }
    const target = def.name;
    const cached = bindingFlows.get(target);
    if (cached !== undefined) {
      return cached;
    }
    // Seed the cache so a self-referencing initializer ends instead of looping.
    bindingFlows.set(target, null);

    let initFlow: Flow | null = null;
    const declaration = def.parent;
    if (def.node.init !== null) {
      initFlow = flow(def.node.init, depth + 1);
    } else if (
      declaration.parent.type === AST_NODE_TYPES.ForOfStatement &&
      declaration.parent.left === declaration
    ) {
      // `for (const block of res.content)`: each block is one element.
      initFlow = step(flow(declaration.parent.right, depth + 1), ELEMENT);
    }
    const result = project(def.node.id, initFlow, target) ?? null;
    bindingFlows.set(target, result);
    return result;
  }

  /** The flow reaching `target` when `value` is destructured by `pattern`; undefined if absent. */
  function project(
    pattern: TSESTree.Node,
    value: Flow | null,
    target: TSESTree.Identifier,
  ): Flow | null | undefined {
    switch (pattern.type) {
      case AST_NODE_TYPES.Identifier:
        return pattern === target ? value : undefined;
      case AST_NODE_TYPES.AssignmentPattern:
        return project(pattern.left, value, target);
      case AST_NODE_TYPES.RestElement:
        return project(pattern.argument, null, target);
      case AST_NODE_TYPES.ObjectPattern:
        for (const property of pattern.properties) {
          const found =
            property.type === AST_NODE_TYPES.RestElement
              ? project(property, null, target)
              : project(property.value, projectKey(value, property), target);
          if (found !== undefined) {
            return found;
          }
        }
        return undefined;
      case AST_NODE_TYPES.ArrayPattern:
        for (const element of pattern.elements) {
          if (element === null) {
            continue;
          }
          // `[first, ...others] = res.choices`: `others` is still the array.
          const found =
            element.type === AST_NODE_TYPES.RestElement
              ? project(element.argument, value, target)
              : project(element, step(value, ELEMENT), target);
          if (found !== undefined) {
            return found;
          }
        }
        return undefined;
      default:
        return undefined;
    }
  }

  function projectKey(value: Flow | null, property: TSESTree.Property): Flow | null {
    const key = propertyKeyName(property);
    return key === null ? null : step(value, key);
  }

  function callFlow(node: TSESTree.CallExpression, depth: number): Flow | null {
    const callee = unwrap(node.callee);
    const [first] = node.arguments;
    if (callee.type === AST_NODE_TYPES.Identifier) {
      // `String(text)` is the text.
      if (callee.name === 'String' && first !== undefined && isGlobal(callee)) {
        return outputOnly(flow(first, depth + 1));
      }
      return null;
    }
    if (callee.type !== AST_NODE_TYPES.MemberExpression) {
      return null;
    }
    const method = staticPropertyName(callee);
    if (method === null) {
      return null;
    }
    // `JSON.parse(text)` is still the model's text, now as an object.
    if (
      method === 'parse' &&
      callee.object.type === AST_NODE_TYPES.Identifier &&
      callee.object.name === 'JSON' &&
      isGlobal(callee.object) &&
      first !== undefined
    ) {
      return outputOnly(flow(first, depth + 1));
    }
    const receiver = flow(callee.object, depth + 1);
    if (receiver?.kind === 'output') {
      return PASS_THROUGH_METHODS.has(method) ? receiver : null;
    }
    if (expectsElement(receiver)) {
      if (ELEMENT_METHODS.has(method)) {
        return step(receiver, ELEMENT);
      }
      if (SUBSET_METHODS.has(method)) {
        return receiver;
      }
    }
    return null;
  }

  function outputOnly(value: Flow | null): Flow | null {
    return value?.kind === 'output' ? value : null;
  }

  function flow(raw: TSESTree.Node, depth: number): Flow | null {
    if (depth > MAX_DEPTH) {
      return null;
    }
    const node = unwrap(raw);
    switch (node.type) {
      case AST_NODE_TYPES.AwaitExpression: {
        const spec = sourceCall(node.argument);
        if (spec !== null) {
          return { kind: 'shape', source: spec.label, paths: spec.paths };
        }
        return flow(node.argument, depth + 1);
      }
      case AST_NODE_TYPES.Identifier:
        return bindingFlow(node, depth);
      case AST_NODE_TYPES.MemberExpression: {
        const segment = segmentOf(node);
        return segment === null ? null : step(flow(node.object, depth + 1), segment);
      }
      case AST_NODE_TYPES.CallExpression:
        return callFlow(node, depth);
      case AST_NODE_TYPES.TemplateLiteral:
        return node.expressions.reduce<Flow | null>(
          (found, expression) => found ?? outputOnly(flow(expression, depth + 1)),
          null,
        );
      case AST_NODE_TYPES.BinaryExpression:
        return node.operator === '+'
          ? outputOnly(either(flow(node.left, depth + 1), flow(node.right, depth + 1)))
          : null;
      case AST_NODE_TYPES.LogicalExpression:
        return node.operator === '&&'
          ? flow(node.right, depth + 1)
          : either(flow(node.left, depth + 1), flow(node.right, depth + 1));
      case AST_NODE_TYPES.ConditionalExpression:
        return either(flow(node.consequent, depth + 1), flow(node.alternate, depth + 1));
      case AST_NODE_TYPES.SequenceExpression: {
        const last = node.expressions.at(-1);
        return last === undefined ? null : flow(last, depth + 1);
      }
      default:
        return null;
    }
  }

  return {
    flowOf: (node) => flow(node, 0),
    moduleMemberOf: (node) => moduleMemberOf(node),
    isGlobal,
    constInit,
  };
}
