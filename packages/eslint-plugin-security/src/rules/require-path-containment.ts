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
import { requestSourceOf } from '../request-taint';

const RULE_NAME = 'require-path-containment';

export interface RequirePathContainmentOptions {
  readonly requestObjects?: readonly string[];
  readonly containmentGuards?: readonly string[];
  /** Callees (source text) whose result is a safe file name: `path.basename` is always one. */
  readonly sanitizers?: readonly string[];
}

type RuleOptions = [RequirePathContainmentOptions];
type MessageIds = 'unguardedPathJoin' | 'unguardedFsPath';

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
 * is never flagged by the join check.
 *
 * FILESYSTEM SINKS. The path argument of an `fs` call that reads, writes or
 * deletes (`readFileSync`, `writeFile`, `unlink`, `createReadStream`, ...,
 * through `fs`, `fs.promises`, `fs/promises` and named imports), or of
 * `res.sendFile` / `res.download`, is followed back through in-function data
 * flow (`../request-taint`). It is reported when request-shaped input reaches
 * it, unless the flow is cut by `path.basename`, a number conversion, an
 * allowlist or anchored regex check that admits no `/`, `\` or `:` (`../guards`),
 * or the containment test above on the resolved path that reaches the sink.
 */
const DEFAULT_REQUEST_OBJECTS: readonly string[] = ['req', 'request'];
const HATCH_TOKEN = 'path-containment';
const PATH_MODULES: ReadonlySet<string> = new Set(['path', 'node:path']);
const BUILDERS: ReadonlySet<string> = new Set(['join', 'resolve']);
const FS_MODULES: ReadonlySet<string> = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
/** Receivers that are the fs module by convention, when no import says so. */
const CONVENTIONAL_FS: ReadonlySet<string> = new Set(['fs', 'fsp', 'fsPromises', 'fs.promises']);
/** fs functions whose first argument is a path; the async, sync and promise forms share a name. */
const FS_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'mkdir',
  'mkdirSync',
  'readdir',
  'readdirSync',
  'stat',
  'statSync',
  'lstat',
  'lstatSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'access',
  'accessSync',
  'truncate',
  'truncateSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
  'createReadStream',
  'createWriteStream',
  'readlink',
  'readlinkSync',
  'realpath',
  'realpathSync',
]);
/** fs functions with a second path argument (source and destination). */
const FS_TWO_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'link',
  'linkSync',
  'symlink',
  'symlinkSync',
]);
/** Response methods that serve a file from disk. */
const RESPONSE_FILE_METHODS: ReadonlySet<string> = new Set(['sendFile', 'download']);
const RESPONSE_OBJECTS: ReadonlySet<string> = new Set(['res', 'response', 'reply']);

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
    sanitizers: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Callees (source text, such as `toSafeName`) whose result is a safe file name, so request input passed through one does not reach an fs path. `path.basename` always counts.',
    },
  },
};

interface PathBindings {
  /** Local names of default or namespace imports of `path` / `node:path`. */
  readonly modules: Set<string>;
  /** Local name of an imported `join` / `resolve` to the imported name. */
  readonly builders: Map<string, string>;
  /** Local names of the fs module (`fs`, `fsp`, `const fs = require('node:fs')`). */
  readonly fsModules: Set<string>;
  /** Local name of an imported fs function to its imported name. */
  readonly fsFunctions: Map<string, string>;
  /** Local names bound to `path.basename` (`import { basename } from 'node:path'`). */
  readonly basenames: Set<string>;
}

/** The module a `require('<name>')` call loads, else null. */
function requiredModule(node: TSESTree.Node | null): string | null {
  if (
    node?.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'require' &&
    node.arguments[0]?.type === AST_NODE_TYPES.Literal &&
    typeof node.arguments[0].value === 'string'
  ) {
    return node.arguments[0].value;
  }
  return null;
}

/** Records `const x = require('fs')` and `const { readFile } = require('fs')`. */
function collectRequire(declarator: TSESTree.VariableDeclarator, bindings: PathBindings): void {
  const source = requiredModule(declarator.init);
  if (source === null) {
    return;
  }
  const isFs = FS_MODULES.has(source);
  const isPath = PATH_MODULES.has(source);
  if (declarator.id.type === AST_NODE_TYPES.Identifier) {
    if (isFs) bindings.fsModules.add(declarator.id.name);
    if (isPath) bindings.modules.add(declarator.id.name);
    return;
  }
  if (declarator.id.type !== AST_NODE_TYPES.ObjectPattern) {
    return;
  }
  for (const property of declarator.id.properties) {
    if (
      property.type !== AST_NODE_TYPES.Property ||
      property.computed ||
      property.key.type !== AST_NODE_TYPES.Identifier ||
      property.value.type !== AST_NODE_TYPES.Identifier
    ) {
      continue;
    }
    const imported = property.key.name;
    const local = property.value.name;
    if (isFs && imported === 'promises') bindings.fsModules.add(local);
    if (isFs && (FS_PATH_FUNCTIONS.has(imported) || FS_TWO_PATH_FUNCTIONS.has(imported))) {
      bindings.fsFunctions.set(local, imported);
    }
    if (isPath && BUILDERS.has(imported)) bindings.builders.set(local, imported);
    if (isPath && imported === 'basename') bindings.basenames.add(local);
  }
}

/** Collects how this file names the `path` module and its builders. */
function collectPathBindings(program: TSESTree.Program): PathBindings {
  const bindings: PathBindings = {
    modules: new Set(['path']),
    builders: new Map(),
    fsModules: new Set(CONVENTIONAL_FS),
    fsFunctions: new Map(),
    basenames: new Set(),
  };
  for (const statement of program.body) {
    if (statement.type === AST_NODE_TYPES.VariableDeclaration) {
      for (const declarator of statement.declarations) {
        collectRequire(declarator, bindings);
      }
      continue;
    }
    if (statement.type !== AST_NODE_TYPES.ImportDeclaration) {
      continue;
    }
    const source = statement.source.value;
    const isPath = PATH_MODULES.has(source);
    const isFs = FS_MODULES.has(source);
    if (!isPath && !isFs) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
        const imported =
          specifier.imported.type === AST_NODE_TYPES.Identifier
            ? specifier.imported.name
            : specifier.imported.value;
        const local = specifier.local.name;
        if (isPath && BUILDERS.has(imported)) {
          bindings.builders.set(local, imported);
        }
        if (isPath && imported === 'basename') {
          bindings.basenames.add(local);
        }
        if (isFs && imported === 'promises') {
          bindings.fsModules.add(local);
        }
        if (isFs && (FS_PATH_FUNCTIONS.has(imported) || FS_TWO_PATH_FUNCTIONS.has(imported))) {
          bindings.fsFunctions.set(local, imported);
        }
      } else if (isPath) {
        bindings.modules.add(specifier.local.name);
      } else {
        bindings.fsModules.add(specifier.local.name);
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

/**
 * The path arguments of a filesystem call, with the name to report: an fs
 * function on an fs module or imported by name, or `res.sendFile` /
 * `res.download`. Empty for any other call.
 */
function fsPathArguments(
  node: TSESTree.CallExpression,
  bindings: PathBindings,
  sourceCode: Readonly<TSESLint.SourceCode>,
): { method: string; paths: TSESTree.Node[] } {
  let method: string | null = null;
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    method = bindings.fsFunctions.get(callee.name) ?? null;
  } else if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    const receiver = sourceCode.getText(callee.object).replace(/\s+/gu, '');
    const name = callee.property.name;
    const onFs =
      bindings.fsModules.has(receiver) ||
      (receiver.endsWith('.promises') && bindings.fsModules.has(receiver.slice(0, -'.promises'.length)));
    if (onFs && (FS_PATH_FUNCTIONS.has(name) || FS_TWO_PATH_FUNCTIONS.has(name))) {
      method = name;
    } else if (RESPONSE_OBJECTS.has(receiver) && RESPONSE_FILE_METHODS.has(name)) {
      method = `${receiver}.${name}`;
    }
  }
  if (method === null) {
    return { method: '', paths: [] };
  }
  const bare = method.slice(method.lastIndexOf('.') + 1);
  const count = FS_TWO_PATH_FUNCTIONS.has(bare) ? 2 : 1;
  const paths = node.arguments
    .slice(0, count)
    .filter((arg): arg is TSESTree.Expression => arg.type !== AST_NODE_TYPES.SpreadElement);
  return { method, paths };
}

/** Follows `const` aliases to the expression a path was built from. */
function pathOrigin(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): TSESTree.Node {
  let current = node;
  for (let depth = 0; depth < 8 && current.type === AST_NODE_TYPES.Identifier; depth += 1) {
    const variable = sourceCode.getScope(current).set.get(current.name) ?? findInScopes(current, sourceCode);
    const def = variable?.defs[0];
    if (
      variable?.defs.length !== 1 ||
      def?.type !== 'Variable' ||
      def.parent.kind !== 'const' ||
      def.node.init === null
    ) {
      return current;
    }
    current = def.node.init;
  }
  return current;
}

function findInScopes(
  node: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESLint.Scope.Variable | undefined {
  for (let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      return variable;
    }
  }
  return undefined;
}

export const requirePathContainmentRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Request-shaped input (`req.*`) reaching `path.join` / `path.resolve` or the path of an `fs` call (or `res.sendFile`) without a containment test is a path-traversal sink.',
      cwe: ['CWE-22'],
      owasp: ['A01:2021'],
      securitySeverity: 7.5,
    },
    schema: [optionSchema],
    messages: {
      unguardedFsPath:
        '`{{source}}` (request-shaped input) reaches the path of `{{method}}(...)` with no containment check, a path-traversal sink. Take `path.basename(...)`, check the value against an allowlist, or resolve the path and verify it stays under the base dir (`resolved.startsWith(baseDir + sep)`). If this path is already safe, add a `// path-containment: <reason>` comment.',
      unguardedPathJoin:
        '`{{source}}` (request-shaped input) flows into `{{method}}(...)` and the result is never tested for containment, a path-traversal sink. Store the result and verify it stays under the base dir (`resolved.startsWith(baseDir + sep)`). If this path is already safe, add a `// path-containment: <reason>` comment.',
    },
  },
  defaultOptions: [{ requestObjects: DEFAULT_REQUEST_OBJECTS, containmentGuards: [], sanitizers: [] }],
  create(context, [options]) {
    const requestObjects = new Set(options.requestObjects ?? DEFAULT_REQUEST_OBJECTS);
    const guards = new Set(options.containmentGuards ?? []);
    const { sourceCode } = context;
    let bindings: PathBindings | null = null;

    const scopeOf = (node: TSESTree.Node): TSESTree.Node => enclosingFunction(node) ?? sourceCode.ast;

    /** True when a containment test in the function takes the value `builder` produced. */
    const builderTested = (builder: TSESTree.CallExpression): boolean => {
      const joined = joinedValueNodes(builder, sourceCode);
      return walkSome(
        scopeOf(builder),
        sourceCode.visitorKeys,
        (candidate) =>
          candidate.type === AST_NODE_TYPES.CallExpression &&
          testsJoinedValue(candidate, joined, guards),
      );
    };

    const hatched = (node: TSESTree.Node): boolean => {
      const scope = scopeOf(node);
      return sourceCode
        .getAllComments()
        .some(
          (comment) =>
            comment.range[0] >= scope.range[0] &&
            comment.range[1] <= scope.range[1] &&
            comment.value.includes(HATCH_TOKEN),
        );
    };

    const checkFsCall = (node: TSESTree.CallExpression, current: PathBindings): void => {
      const { method, paths } = fsPathArguments(node, current, sourceCode);
      if (paths.length === 0) {
        return;
      }
      const sanitizers = new Set([
        ...current.basenames,
        ...[...current.modules].map((name) => `${name}.basename`),
        ...(options.sanitizers ?? []).map((name) => name.replace(/\s+/gu, '').replace(/\(\)$/u, '')),
      ]);
      for (const pathArgument of paths) {
        const origin = pathOrigin(pathArgument, sourceCode);
        if (origin.type === AST_NODE_TYPES.CallExpression && pathBuilderMethod(origin.callee, current) !== null) {
          // A resolved path: the containment test on it decides, and a direct
          // request argument is already reported at the join.
          if (builderTested(origin) || requestSource(origin, requestObjects) !== null) {
            continue;
          }
        }
        const source = requestSourceOf(pathArgument, node, {
          requestObjects,
          context: 'path',
          sanitizers,
        }, sourceCode);
        if (source === null || hatched(node)) {
          continue;
        }
        context.report({
          node: pathArgument,
          messageId: 'unguardedFsPath',
          data: { source: sourceCode.getText(source), method },
        });
      }
    };

    return {
      Program(program): void {
        bindings = collectPathBindings(program);
      },
      CallExpression(node): void {
        if (bindings === null) {
          return;
        }
        checkFsCall(node, bindings);
        const method = pathBuilderMethod(node.callee, bindings);
        if (method === null) {
          return;
        }
        const source = requestSource(node, requestObjects);
        if (source === null) {
          return;
        }
        if (builderTested(node) || hatched(node)) {
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
