import {
  calleeName,
  calleePath,
  enclosingFunction,
  fileMatchesAnyGlob,
  globToRegExp,
  resolveAllowIn,
  walkSome,
} from '@noctcore/eslint-utils';
import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { moduleMemberOf, propertyKeyName, staticPropertyName, unwrap } from '../utils/modules';

const RULE_NAME = 'no-renderer-setting-to-fs';

/** `store.get('key')`: the call's return value is the renderer-writable setting. */
export interface StoreCallSource {
  readonly object: string;
  readonly method: string;
  readonly keys?: readonly string[];
}

/** `loadSettings()`: every property of the returned object is a renderer-writable setting. */
export interface LoaderSource {
  readonly function: string;
  readonly keys?: readonly string[];
}

export type SettingSource = StoreCallSource | LoaderSource;

export interface NoRendererSettingToFsOptions {
  /** Calls whose result the renderer can write. Without any, the rule reports nothing. */
  readonly sources?: readonly SettingSource[];
  /** Functions that check a path and throw (or return false) when it escapes its base. */
  readonly sanitizers?: readonly string[];
  /** Globs of files the rule skips. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoRendererSettingToFsOptions];
type MessageIds = 'settingToFs';

/*
 * A settings store the renderer can write through IPC is renderer input, even
 * when the main process reads it back later from another file. A path kept in
 * such a setting (a custom avatar, a background image, an export folder) and
 * handed to `fs` or `shell.openPath` without a containment check lets any
 * frame that reaches the settings channel read, overwrite or open any file
 * the app can.
 *
 * PRECISION FIRST, and opt-in. Which calls return renderer-writable values is
 * a fact about the app, so it comes from `sources`; without them the rule is
 * silent. A value is followed only inside one function: through `const`
 * bindings, destructuring, member reads, template literals, `+`, `??` / `||`,
 * `await` and `path.join` / `resolve` / `normalize`. Anything else ends the
 * chain: a parameter, a `let`, a module-level binding, a property written
 * later, any other call (a helper that returns a checked path included) and
 * `path.basename`, which strips the directories. An ended chain is silent.
 *
 * A containment test on a path built from the setting ends the chain too: the
 * same shapes `security/require-path-containment` accepts (`full.startsWith(base)`
 * or `path.relative(base, full)` on the built path), plus a call to a configured
 * sanitizer that takes any binding of the chain, when it comes before the sink
 * in the same function.
 */

/** `fs` functions whose first argument is a path. */
const FS_ONE_PATH: ReadonlySet<string> = new Set([
  'access',
  'accessSync',
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'createReadStream',
  'createWriteStream',
  'existsSync',
  'lstat',
  'lstatSync',
  'mkdir',
  'mkdirSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'readdir',
  'readdirSync',
  'readFile',
  'readFileSync',
  'rm',
  'rmdir',
  'rmdirSync',
  'rmSync',
  'stat',
  'statSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
]);
/** `fs` functions whose first two arguments are both paths. */
const FS_TWO_PATHS: ReadonlySet<string> = new Set([
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
]);
/** Electron `shell` functions that take a filesystem path. */
const SHELL_PATH: ReadonlySet<string> = new Set(['openPath', 'showItemInFolder', 'trashItem']);
/** `path` functions whose result still carries every part of their arguments. */
const PATH_BUILDERS: ReadonlySet<string> = new Set(['join', 'resolve', 'normalize']);
/** String methods whose result is still the same text. */
const PASS_THROUGH_METHODS: ReadonlySet<string> = new Set([
  'toString',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);

const MAX_DEPTH = 12;
const MAX_LABEL = 60;

/** A renderer-writable value reaching an expression, and the bindings it went through. */
interface Flow {
  /** How the report names the source. */
  readonly label: string;
  /** Set while the value is a loader's settings object, before a key is read off it. */
  readonly pendingKeys: readonly string[] | null | undefined;
  /** Every `const` binding the value passed through. */
  readonly bindings: ReadonlySet<TSESLint.Scope.Variable>;
  /** The bindings that hold a `path.join` / `resolve` / `normalize` result. */
  readonly built: ReadonlySet<TSESLint.Scope.Variable>;
  /** True when the value went through a path builder. */
  readonly isBuilt: boolean;
}

function isValue(flow: Flow | null): flow is Flow {
  return flow !== null && flow.pendingKeys === undefined;
}

function keyMatches(keys: readonly string[] | null, key: string): boolean {
  return keys === null || keys.some((glob) => globToRegExp(glob).test(key));
}

function shortLabel(text: string): string {
  const flat = text.replace(/\s+/gu, ' ');
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 3)}...` : flat;
}

/** The text of a string literal or a template literal without substitutions, else null. */
function staticString(node: TSESTree.Node | undefined): string | null {
  if (node === undefined) return null;
  const value = unwrap(node);
  if (value.type === AST_NODE_TYPES.Literal && typeof value.value === 'string') return value.value;
  if (value.type === AST_NODE_TYPES.TemplateLiteral && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** True when a dotted callee or receiver path is `name` or ends in `.name`. */
function pathEndsWith(path: string | null, name: string): boolean {
  return path !== null && (path === name || path.endsWith(`.${name}`));
}

const keysSchema: JSONSchema4 = {
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description:
    'Only these setting keys count (globs: `*` matches any run of characters except `/`, so `theme.*` matches every key under `theme`). Unset, every key counts; set, a key the rule cannot read as a string does not count.',
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sources: {
      type: 'array',
      description:
        'Calls whose result the renderer can write: `{ object, method }` for a store call such as `store.get(key)`, or `{ function }` for a loader whose returned object holds the settings. Empty by default, so nothing is reported.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['object', 'method'],
            properties: {
              object: {
                type: 'string',
                description:
                  'The receiver of the call (`store` matches `store.get` and `this.store.get`).',
              },
              method: { type: 'string', description: 'The method that returns a setting, such as `get`.' },
              keys: keysSchema,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['function'],
            properties: {
              function: {
                type: 'string',
                description:
                  'A function that returns the settings object (`loadSettings` matches `loadSettings()` and `this.loadSettings()`).',
              },
              keys: keysSchema,
            },
          },
        ],
      },
    },
    sanitizers: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Functions that check a path stays inside its base, such as `assertInside`. A call to one that takes a binding the setting went through, before the sink, ends the chain.',
    },
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Globs of files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root.',
    },
  },
};

export const noRendererSettingToFsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a path read from a renderer-writable settings store reaching an `fs` call or `shell.openPath` in the same function without a containment check.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      settingToFs:
        '`{{source}}` is a setting the renderer can write, and it reaches {{sink}} without a containment check. Any frame that can send on the settings channel can point it at any file: resolve it under a base directory and check the result still starts with it, or keep only `path.basename(...)` of it.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const sources = options.sources ?? [];
    if (sources.length === 0) return {};
    if (fileMatchesAnyGlob(context.filename, resolveAllowIn(options, [], []), context.cwd)) return {};

    const sanitizers = new Set(options.sanitizers ?? []);
    const { sourceCode } = context;

    function variableOf(node: TSESTree.Identifier): TSESLint.Scope.Variable | null {
      return ASTUtils.findVariable(sourceCode.getScope(node), node) ?? null;
    }

    function isPathMember(callee: TSESTree.Node, names: ReadonlySet<string>): string | null {
      const member = moduleMemberOf(callee, sourceCode);
      if (member?.module !== 'path') return null;
      const name = member.path.at(-1);
      // `path.join` and `path.posix.join` / `path.win32.join`.
      const prefixOk =
        member.path.length === 1 ||
        (member.path.length === 2 && (member.path[0] === 'posix' || member.path[0] === 'win32'));
      return prefixOk && name !== undefined && names.has(name) ? name : null;
    }

    function fresh(label: string, pendingKeys?: readonly string[] | null): Flow {
      return { label, pendingKeys, bindings: new Set(), built: new Set(), isBuilt: false };
    }

    /** The flow a configured source call starts, or null. */
    function sourceFlow(call: TSESTree.CallExpression): Flow | null {
      const callee = unwrap(call.callee);
      for (const source of sources) {
        if ('function' in source) {
          if (!pathEndsWith(calleePath(callee, { allowThis: true }), source.function)) continue;
          return fresh(shortLabel(`${sourceCode.getText(callee)}()`), source.keys ?? null);
        }
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          staticPropertyName(callee) !== source.method ||
          !pathEndsWith(calleePath(unwrap(callee.object), { allowThis: true }), source.object)
        ) {
          continue;
        }
        if (source.keys !== undefined) {
          const key = staticString(call.arguments[0]);
          if (key === null || !keyMatches(source.keys, key)) continue;
        }
        return fresh(shortLabel(sourceCode.getText(call)));
      }
      return null;
    }

    /** The flow after reading `key` (null: a computed key) off a flow. */
    function step(value: Flow | null, key: string | null): Flow | null {
      if (value === null) return null;
      if (value.pendingKeys === undefined) return value;
      if (key === null) {
        return value.pendingKeys === null ? { ...value, pendingKeys: undefined } : null;
      }
      if (!keyMatches(value.pendingKeys, key)) return null;
      return { ...value, label: shortLabel(`${value.label}.${key}`), pendingKeys: undefined };
    }

    function either(left: Flow | null, right: Flow | null): Flow | null {
      return isValue(left) ? left : isValue(right) ? right : null;
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
                : project(property.value, step(value, propertyKeyName(property)), target);
            if (found !== undefined) return found;
          }
          return undefined;
        case AST_NODE_TYPES.ArrayPattern:
          for (const element of pattern.elements) {
            if (element === null) continue;
            const found = project(element, isValue(value) ? value : null, target);
            if (found !== undefined) return found;
          }
          return undefined;
        default:
          return undefined;
      }
    }

    /** A `const` binding defined in the same function as its use, followed to its initializer. */
    function bindingFlow(node: TSESTree.Identifier, depth: number): Flow | null {
      const variable = variableOf(node);
      const def = variable?.defs[0];
      if (
        variable == null ||
        variable.defs.length !== 1 ||
        def === undefined ||
        def.type !== 'Variable' ||
        def.parent.kind !== 'const' ||
        def.node.init === null ||
        enclosingFunction(def.node) !== enclosingFunction(node)
      ) {
        return null;
      }
      const result = project(def.node.id, flow(def.node.init, depth + 1), def.name);
      if (result === undefined || result === null) return null;
      const bindings = new Set(result.bindings).add(variable);
      const built = result.isBuilt ? new Set(result.built).add(variable) : result.built;
      return { ...result, bindings, built };
    }

    function callFlow(node: TSESTree.CallExpression, depth: number): Flow | null {
      const started = sourceFlow(node);
      if (started !== null) return started;
      if (isPathMember(node.callee, PATH_BUILDERS) !== null) {
        for (const argument of node.arguments) {
          const found = flow(argument, depth + 1);
          if (isValue(found)) return { ...found, isBuilt: true };
        }
        return null;
      }
      const callee = unwrap(node.callee);
      const [first] = node.arguments;
      if (callee.type === AST_NODE_TYPES.Identifier) {
        // `String(value)` is the value.
        if (callee.name !== 'String' || first === undefined) return null;
        const variable = variableOf(callee);
        if (variable !== null && variable.defs.length > 0) return null;
        const found = flow(first, depth + 1);
        return isValue(found) ? found : null;
      }
      if (callee.type !== AST_NODE_TYPES.MemberExpression) return null;
      const method = staticPropertyName(callee);
      if (method === null || !PASS_THROUGH_METHODS.has(method)) return null;
      const receiver = flow(callee.object, depth + 1);
      return isValue(receiver) ? receiver : null;
    }

    function flow(raw: TSESTree.Node, depth: number): Flow | null {
      if (depth > MAX_DEPTH) return null;
      const node = unwrap(raw);
      switch (node.type) {
        case AST_NODE_TYPES.AwaitExpression:
          return flow(node.argument, depth + 1);
        case AST_NODE_TYPES.Identifier:
          return bindingFlow(node, depth);
        case AST_NODE_TYPES.MemberExpression:
          return step(flow(node.object, depth + 1), staticPropertyName(node));
        case AST_NODE_TYPES.CallExpression:
          return callFlow(node, depth);
        case AST_NODE_TYPES.TemplateLiteral:
          for (const expression of node.expressions) {
            const found = flow(expression, depth + 1);
            if (isValue(found)) return found;
          }
          return null;
        case AST_NODE_TYPES.BinaryExpression:
          return node.operator === '+'
            ? either(flow(node.left, depth + 1), flow(node.right, depth + 1))
            : null;
        case AST_NODE_TYPES.LogicalExpression:
          return node.operator === '&&'
            ? flow(node.right, depth + 1)
            : either(flow(node.left, depth + 1), flow(node.right, depth + 1));
        case AST_NODE_TYPES.ConditionalExpression:
          return either(flow(node.consequent, depth + 1), flow(node.alternate, depth + 1));
        default:
          return null;
      }
    }

    function holds(node: TSESTree.Node, variables: ReadonlySet<TSESLint.Scope.Variable>): boolean {
      const value = unwrap(node);
      if (value.type !== AST_NODE_TYPES.Identifier) return false;
      const variable = variableOf(value);
      return variable !== null && variables.has(variable);
    }

    /** True when `call` is a containment test of the value in `found`. */
    function isContainmentTest(call: TSESTree.CallExpression, found: Flow): boolean {
      const name = calleeName(unwrap(call.callee));
      if (name === null) return false;
      if (sanitizers.has(name)) return call.arguments.some((arg) => holds(arg, found.bindings));
      if (name === 'startsWith') {
        const callee = unwrap(call.callee);
        return callee.type === AST_NODE_TYPES.MemberExpression && holds(callee.object, found.built);
      }
      if (name === 'relative') return call.arguments.some((arg) => holds(arg, found.built));
      return false;
    }

    /** True when a containment test of the value comes before `sink` in its function. */
    function contained(sink: TSESTree.CallExpression, found: Flow): boolean {
      if (found.bindings.size === 0) return false;
      const scope: TSESTree.Node = enclosingFunction(sink) ?? sourceCode.ast;
      return walkSome(
        scope,
        sourceCode.visitorKeys,
        (candidate) =>
          candidate.type === AST_NODE_TYPES.CallExpression &&
          candidate.range[0] < sink.range[0] &&
          isContainmentTest(candidate, found),
      );
    }

    function check(
      sink: TSESTree.CallExpression,
      argument: TSESTree.CallExpressionArgument | undefined,
      sinkName: string,
    ): void {
      if (argument === undefined || argument.type === AST_NODE_TYPES.SpreadElement) return;
      const found = flow(argument, 0);
      if (!isValue(found) || contained(sink, found)) return;
      context.report({
        node: argument,
        messageId: 'settingToFs',
        data: { source: found.label, sink: sinkName },
      });
    }

    return {
      CallExpression(node): void {
        const member = moduleMemberOf(node.callee, sourceCode);
        if (member === null) return;
        const [first, second] = node.arguments;
        const { module, path } = member;
        if (module === 'electron') {
          const method = path[1];
          if (path.length === 2 && path[0] === 'shell' && method !== undefined && SHELL_PATH.has(method)) {
            check(node, first, `\`shell.${method}\``);
          }
          return;
        }
        if (module !== 'fs') return;
        const method =
          path.length === 1 || (path.length === 2 && path[0] === 'promises') ? path.at(-1) : undefined;
        if (method === undefined) return;
        const sinkName = `a path argument of \`fs.${method}\``;
        if (FS_ONE_PATH.has(method)) {
          check(node, first, sinkName);
        } else if (FS_TWO_PATHS.has(method)) {
          check(node, first, sinkName);
          check(node, second, sinkName);
        }
      },
    };
  },
});
