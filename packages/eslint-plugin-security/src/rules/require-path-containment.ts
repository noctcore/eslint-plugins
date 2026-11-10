import {
  AST_NODE_TYPES,
  calleeName,
  enclosingFunction,
  walkSome,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'require-path-containment';

export interface RequirePathContainmentOptions {
  readonly requestObjects?: readonly string[];
  readonly containmentGuards?: readonly string[];
}

type RuleOptions = [RequirePathContainmentOptions];
type MessageIds = 'unguardedPathJoin';

/*
 * Path-traversal precision, OPT-IN. `path.join(baseDir, req.params.file)` lets a
 * crafted `../../etc/passwd` escape the intended directory. The safe pattern is
 * to resolve, then verify the result still starts with the base dir before
 * touching the filesystem.
 *
 * DELIBERATELY NARROW to stay high-precision without type information: it fires
 * only when a member expression rooted at a request-shaped object (`req.*` /
 * `request.*` by default, configurable) is passed DIRECTLY into `join` /
 * `resolve` from `path` / `node:path` (as `path.join`, through a default or
 * namespace import under any name, or as an imported `join` / `resolve`), and
 * the joined value is never tested. A test is a call that takes the joined
 * value: `full.startsWith(...)`, `path.relative(base, full)`, or a configured
 * guard function `isInside(base, full)`. The joined value is the variable the
 * join is stored in, plus any variable initialised from it, so
 * `const full = normalize(join(base, f)); if (!full.startsWith(base)) ...` is
 * guarded. A test of some other string (`name.startsWith('.')`) is not. An
 * escape-hatch comment containing `path-containment` anywhere in the function
 * silences it.
 *
 * Because a sanitized value is bound to a local first (`const safe = clean(req.x)`
 * then `path.join(base, safe)`), that shape is not a direct request argument and
 * is never flagged.
 */
const DEFAULT_REQUEST_OBJECTS: readonly string[] = ['req', 'request'];
const HATCH_TOKEN = 'path-containment';
const PATH_MODULES: ReadonlySet<string> = new Set(['path', 'node:path']);
const BUILDERS: ReadonlySet<string> = new Set(['join', 'resolve']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestObjects: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Root object names treated as request-shaped input, e.g. `ctx` or a renderer-writable `settings` object.',
    },
    containmentGuards: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Names of project helpers that verify containment; a call to one that takes the joined value counts as a guard.',
    },
  },
};

interface PathBindings {
  /** Local names of default or namespace imports of `path` / `node:path`. */
  readonly modules: Set<string>;
  /** Local name of an imported `join` / `resolve` to the imported name. */
  readonly builders: Map<string, string>;
}

/** Collects how this file names the `path` module and its builders. */
function collectPathBindings(program: TSESTree.Program): PathBindings {
  const bindings: PathBindings = { modules: new Set(['path']), builders: new Map() };
  for (const statement of program.body) {
    if (
      statement.type !== AST_NODE_TYPES.ImportDeclaration ||
      !PATH_MODULES.has(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
        const imported =
          specifier.imported.type === AST_NODE_TYPES.Identifier
            ? specifier.imported.name
            : specifier.imported.value;
        if (BUILDERS.has(imported)) {
          bindings.builders.set(specifier.local.name, imported);
        }
      } else {
        bindings.modules.add(specifier.local.name);
      }
    }
  }
  return bindings;
}

/** The `join` / `resolve` builder a callee names, or null for any other callee. */
function pathBuilderMethod(callee: TSESTree.Node, bindings: PathBindings): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return bindings.builders.get(callee.name) ?? null;
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.object.type !== AST_NODE_TYPES.Identifier ||
    !bindings.modules.has(callee.object.name) ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  return BUILDERS.has(callee.property.name) ? callee.property.name : null;
}

/** The root identifier of a member chain (`req.params.file` gives `req`), else null. */
function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current: TSESTree.Node = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    current = current.object;
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

/** The first argument that is a member chain rooted at a request object. */
function requestSource(
  call: TSESTree.CallExpression,
  requestObjects: ReadonlySet<string>,
): TSESTree.MemberExpression | null {
  for (const arg of call.arguments) {
    if (arg.type !== AST_NODE_TYPES.MemberExpression) {
      continue;
    }
    const root = rootIdentifier(arg);
    if (root !== null && requestObjects.has(root.name)) {
      return arg;
    }
  }
  return null;
}

const PATH_PRESERVING: ReadonlySet<string> = new Set(['join', 'resolve', 'normalize']);

/**
 * True when `parent` passes `child`'s path value on: a type wrapper, or a
 * `join` / `resolve` / `normalize` call taking it. A call to anything else
 * (`readFileSync(full)`) produces a different value.
 */
function passesPathOn(parent: TSESTree.Node, child: TSESTree.Node): boolean {
  switch (parent.type) {
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
      return true;
    case AST_NODE_TYPES.CallExpression: {
      const name = calleeName(parent.callee);
      return name !== null && PATH_PRESERVING.has(name) && parent.arguments.some((arg) => arg === child);
    }
    default:
      return false;
  }
}

/** The declarator a path value is stored in (`const full = normalize(<node>)`), else null. */
function storingDeclarator(node: TSESTree.Node): TSESTree.VariableDeclarator | null {
  let child: TSESTree.Node = node;
  let parent = node.parent;
  while (parent != null && passesPathOn(parent, child)) {
    child = parent;
    parent = parent.parent;
  }
  return parent?.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === child &&
    parent.id.type === AST_NODE_TYPES.Identifier
    ? parent
    : null;
}

/**
 * Every node holding the joined value: the join itself, the variable it is
 * stored in, and any variable initialised from that one through path calls,
 * transitively (`const full = join(...)`, `const normal = normalize(full)`).
 */
function joinedValueNodes(
  join: TSESTree.CallExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): Set<TSESTree.Node> {
  const nodes = new Set<TSESTree.Node>([join]);
  const queue: TSESTree.Node[] = [join];
  const seen = new Set<TSESLint.Scope.Variable>();
  for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
    const declarator = storingDeclarator(current);
    const variable = declarator === null ? undefined : sourceCode.getDeclaredVariables(declarator)[0];
    if (variable === undefined || seen.has(variable)) {
      continue;
    }
    seen.add(variable);
    for (const reference of variable.references) {
      if (reference.isRead()) {
        nodes.add(reference.identifier);
        queue.push(reference.identifier);
      }
    }
  }
  return nodes;
}

/** True when `call` tests one of the joined identifiers. */
function testsJoinedValue(
  call: TSESTree.CallExpression,
  joined: ReadonlySet<TSESTree.Node>,
  guards: ReadonlySet<string>,
): boolean {
  const name = calleeName(call.callee);
  if (name === null) {
    return false;
  }
  if (name === 'startsWith') {
    return (
      call.callee.type === AST_NODE_TYPES.MemberExpression && joined.has(call.callee.object)
    );
  }
  if (name === 'relative' || guards.has(name)) {
    return call.arguments.some((arg) => joined.has(arg));
  }
  return false;
}

export const requirePathContainmentRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Request-shaped input (`req.*`) passed directly into `path.join` / `path.resolve` without a containment test on the result is a path-traversal sink.',
    },
    schema: [optionSchema],
    messages: {
      unguardedPathJoin:
        '`{{source}}` (request-shaped input) flows into `{{method}}(...)` and the result is never tested for containment, a path-traversal sink. Store the result and verify it stays under the base dir (`resolved.startsWith(baseDir + sep)`). If this path is already safe, add a `// path-containment: <reason>` comment.',
    },
  },
  defaultOptions: [{ requestObjects: DEFAULT_REQUEST_OBJECTS, containmentGuards: [] }],
  create(context, [options]) {
    const requestObjects = new Set(options.requestObjects ?? DEFAULT_REQUEST_OBJECTS);
    const guards = new Set(options.containmentGuards ?? []);
    const { sourceCode } = context;
    let bindings: PathBindings | null = null;

    return {
      Program(program): void {
        bindings = collectPathBindings(program);
      },
      CallExpression(node): void {
        if (bindings === null) {
          return;
        }
        const method = pathBuilderMethod(node.callee, bindings);
        if (method === null) {
          return;
        }
        const source = requestSource(node, requestObjects);
        if (source === null) {
          return;
        }

        const scope: TSESTree.Node = enclosingFunction(node) ?? sourceCode.ast;
        const joined = joinedValueNodes(node, sourceCode);
        const guarded = walkSome(
          scope,
          sourceCode.visitorKeys,
          (candidate) =>
            candidate.type === AST_NODE_TYPES.CallExpression &&
            testsJoinedValue(candidate, joined, guards),
        );
        if (guarded) {
          return;
        }
        const hatched = sourceCode
          .getAllComments()
          .some(
            (comment) =>
              comment.range[0] >= scope.range[0] &&
              comment.range[1] <= scope.range[1] &&
              comment.value.includes(HATCH_TOKEN),
          );
        if (hatched) {
          return;
        }

        context.report({
          node,
          messageId: 'unguardedPathJoin',
          data: { source: sourceCode.getText(source), method },
        });
      },
    };
  },
});
