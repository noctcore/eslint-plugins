import {
  AST_NODE_TYPES,
  containmentGuard,
  enclosingFunction,
  failsOutside,
  holdsInside,
  isAssertedBefore,
  isExitGuard,
  isGuardedByLogicalBefore,
  isProcessCwd,
  singleInitializer,
  walkSome,
  type PathContainmentContext,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';
import { ASTUtils } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  actsOnDirectory,
  collectPathBindings,
  fsFunction,
  fsPathArguments,
  isPathSep,
  pathFunction,
  peel,
  propertyName,
  type PathBindings,
} from '../fs-sinks';
import { isAllowlistedMember, isGuardedBefore, isProvenSafeValue } from '../guards';
import { isRequestFieldParameter, requestSourceOf, type TaintOptions } from '../request-taint';
import { flowStep, flowSteps, handlerRole, isImmediateCallback } from '../value-flow';

const RULE_NAME = 'require-path-containment';

export interface RequirePathContainmentOptions {
  readonly requestObjects?: readonly string[];
  readonly containmentGuards?: readonly string[];
  /** Callees (source text) whose result is a safe file name. */
  readonly sanitizers?: readonly string[];
}

type RuleOptions = [RequirePathContainmentOptions];
type MessageIds = 'unguardedPathJoin' | 'unguardedFsPath' | 'unguardedFsHelper';
type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;
type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/*
 * Path-traversal precision, OPT-IN. `path.join(baseDir, req.params.file)` lets a
 * crafted `../../etc/passwd` escape the intended directory. The safe pattern is
 * to resolve, then verify the result still starts with the base dir and a
 * separator before touching the filesystem.
 *
 * JOIN CHECK. It fires when a member expression rooted at a request-shaped
 * object (`req.*` / `request.*` by default, configurable) is passed directly
 * into `join` / `resolve` from `path` / `node:path`, and the joined value is
 * never tested. A test takes the joined value (the variable it is stored in,
 * and any variable initialised from that one through `normalize`, a one
 * argument `resolve` or `join`, or `realpath`), with the matcher shared with
 * the electron rule (`@noctcore/eslint-utils` `pathContainment`):
 * `full.startsWith(base + sep)` (the base must end in a separator, or
 * `/srv/app-evil` passes a test for `/srv/app`), a `path.relative(base, full)`
 * result refused when it climbs and when it is absolute (on Windows `relative`
 * returns an absolute path across drives), or a configured guard function
 * `isInside(base, full)`, against a base the input does not pick and that is
 * not `/`, `''`, `path.sep` or `process.cwd()`. The test counts only when its
 * result decides whether a later use of the joined value runs (an `if` that
 * exits when the path is outside decides that for all that follows); an ignored test,
 * one that guards another statement, and one in a nested function do not. A
 * test of some other string (`name.startsWith('.')`) is not. An escape-hatch
 * comment containing `path-containment` anywhere in the function silences it.
 *
 * FILESYSTEM SINKS. The path argument of an `fs` call (`readFileSync`,
 * `writeFile`, `rm`, `existsSync`, `watch`, `createReadStream`, ...) through
 * `fs`, `fs.promises`, `fs/promises`, named imports, `require` and dynamic
 * `import()` (see `../fs-sinks`), or of Express's `res.sendFile` /
 * `res.download`, is followed back through in-function data flow
 * (`../request-taint`). It is reported when request-shaped input reaches it,
 * unless:
 *  - the flow is cut by an allowlist, an anchored regex or a schema that
 *    admits no `/`, `\`, `:` and cannot match `.`, `..` or an empty value
 *    (`../guards`), a number conversion, `path.extname`, or a configured
 *    sanitizer;
 *  - it passes through `path.basename` into a binding that is refused as `.`
 *    and `..` before the sink (`basename('..')` is `'..'`, so a bare
 *    `basename` is not containment), and as `''` too before a call that acts
 *    on a directory (`rm`, `readdir`, fs-extra `remove`: `join(base, '')` is
 *    the base);
 *  - the path is resolved and one of the tests above runs before the sink on
 *    every path to it (an `if` that exits, or an `if`, `?:`, `&&` or `||`
 *    around the sink). A test that only runs somewhere in the function does
 *    not count here. The tested path must reach the sink as it is (through
 *    bindings, a literal holder or an identity helper): `join(full, '..')`,
 *    `full + '/..'` and the like are new paths.
 * `res.sendFile(p, { root })` is checked on the root: Express refuses a `..`
 * segment of `p` (after decoding it) and serves it under the root. A root that
 * confines nothing (`'/'`, `''`, `'.'`, `process.cwd()`, an environment
 * value that may be unset) is not one, so `p` is checked instead; a spread or
 * a later `root` key after the root may replace it. After a spread of unknown
 * length, every later argument of an fs call is checked as a path.
 *
 * HELPERS. A call to a local function (a declaration, or a `const` or a `let`
 * never reassigned that holds one) that forwards one of its parameters to an
 * fs sink path with no containment check is reported at the call when request
 * input reaches that argument. A destructured parameter is followed by key. One
 * level only: a helper that passes the path on to another helper is not
 * followed.
 *
 * NOT MODELLED. Symbolic links (a contained path can still point outside;
 * compare `fs.realpath` results for that), `path.posix` / `path.win32` (never
 * read as containment), Windows names with a trailing dot or space (`.. `
 * passes a `..` check and Win32 trims it), and helpers more than one call deep.
 */
const DEFAULT_REQUEST_OBJECTS: readonly string[] = ['req', 'request'];
const HATCH_TOKEN = 'path-containment';
const BUILDERS: ReadonlySet<string> = new Set(['join', 'resolve']);
const REALPATH: ReadonlySet<string> = new Set(['realpath', 'realpathSync']);
const MAX_DEPTH = 8;

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
        'Names of project helpers that verify containment; a call to one that takes the resolved path counts as a guard.',
    },
    sanitizers: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Callees (source text, such as `toSafeName`) whose result is a safe file name (never `.` or `..`, no separator), so request input passed through one does not reach an fs path.',
    },
  },
};

/**
 * True for a root text that confines nothing: every segment is empty or `.`,
 * so it normalises to `''`, `/` or the working directory (`'.//'`, `'/.'`).
 */
function isWeakRootText(text: string): boolean {
  return text.split(/[\\/]/u).every((segment) => segment === '' || segment === '.');
}

/** An fs sink a helper's parameter reaches. */
interface HelperSink {
  readonly method: string;
  /** For a destructured parameter, the top-level keys whose bindings reach it; null for the whole value. */
  readonly keys: ReadonlySet<string> | null;
}

/** The top-level key of an object pattern that holds `name` (`a` for `{ a: { b } }`), else null. */
function topLevelKey(pattern: TSESTree.Node, name: TSESTree.Identifier): string | null {
  if (pattern.type !== AST_NODE_TYPES.ObjectPattern) {
    return null;
  }
  for (const property of pattern.properties) {
    if (property.range[0] > name.range[0] || property.range[1] < name.range[1]) {
      continue;
    }
    if (property.type !== AST_NODE_TYPES.Property) {
      return null;
    }
    if (property.key.type === AST_NODE_TYPES.Identifier && !property.computed) {
      return property.key.name;
    }
    return property.key.type === AST_NODE_TYPES.Literal ? String(property.key.value) : null;
  }
  return null;
}

/** The root identifier of a member chain (`req.params.file` gives `req`), through type wrappers. */
function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current = peel(node);
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    current = peel(current.object);
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

/** True when `root` names a request object: by name, or by its place in a handler. */
function isRequestRoot(
  root: TSESTree.Identifier,
  requestObjects: ReadonlySet<string>,
  sourceCode: SourceCode,
): boolean {
  return requestObjects.has(root.name) || handlerRole(root, sourceCode) === 'request';
}

/**
 * The first request member an argument holds (read through type wrappers,
 * optional chains and exact moves such as `const name = req.params.name`, a
 * helper that returns its argument or a callback's value), other than one
 * checked against a literal allowlist before the call. A value proven safe
 * for a path on the way stops the search for that argument.
 */
function requestSource(
  call: TSESTree.CallExpression,
  requestObjects: ReadonlySet<string>,
  sourceCode: SourceCode,
): TSESTree.Node | null {
  for (const arg of call.arguments) {
    for (const step of flowSteps(arg, call, sourceCode, 'taint')) {
      const inner = peel(step.node);
      if (inner.type === AST_NODE_TYPES.Identifier) {
        if (isProvenSafeValue(inner, step.sink, 'path', sourceCode)) {
          break;
        }
        continue;
      }
      if (inner.type !== AST_NODE_TYPES.MemberExpression) {
        continue;
      }
      const root = rootIdentifier(inner);
      if (root !== null && isRequestRoot(root, requestObjects, sourceCode)) {
        if (isAllowlistedMember(step.node, step.sink, sourceCode)) {
          break;
        }
        return step.node;
      }
    }
  }
  return null;
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
        '`{{source}}` (request-shaped input) reaches the path of `{{method}}(...)` with no containment check, a path-traversal sink. Check the value against an allowlist or an anchored regex that cannot match `.` or `..` (`/^[\\w-][\\w.-]*$/`), refuse `.` and `..` after `path.basename(...)` (and an empty name before a call that acts on a directory), or resolve the path and verify it stays under the base dir (`resolved.startsWith(baseDir + sep)`) before the call. If this path is already safe, add a `// path-containment: <reason>` comment.',
      unguardedFsHelper:
        '`{{source}}` (request-shaped input) is passed to `{{helper}}(...)`, which uses it as the path of `{{method}}(...)` with no containment check, a path-traversal sink. Check the value before the call (an allowlist, or an anchored regex that cannot match `.` or `..`), or resolve the path in the helper and verify it stays under the base dir. If this path is already safe, add a `// path-containment: <reason>` comment.',
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
    let taintOptions: TaintOptions | null = null;
    const helperCache = new Map<FunctionNode, Map<number, HelperSink>>();

    // A callback run where it is passed (`[x].forEach((v) => ...)`) is part of the function around it.
    const scopeOf = (node: TSESTree.Node): TSESTree.Node => {
      let fn = enclosingFunction(node);
      while (fn !== null && isImmediateCallback(fn, sourceCode)) {
        fn = enclosingFunction(fn);
      }
      return fn ?? sourceCode.ast;
    };
    // A handler's response parameter under another name: `(a, b) => b.sendFile(p)`.
    const isResponse = (node: TSESTree.Identifier): boolean => handlerRole(node, sourceCode) === 'response';

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

    // -----------------------------------------------------------------------
    // The resolved path and the values that hold it
    // -----------------------------------------------------------------------

    /**
     * For a call that keeps one path value (`normalize(p)`, `resolve(p)`,
     * `join(p)`, `realpath(p)`), that value; for a `join` / `resolve` of
     * several segments, the call itself as a root; else null.
     */
    const pathStep = (
      node: TSESTree.Node,
      current: PathBindings,
    ): { kind: 'wrap'; arg: TSESTree.Node } | { kind: 'builder' } | null => {
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return null;
      }
      const first = node.arguments[0];
      if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) {
        return null;
      }
      const name = pathFunction(node.callee, current);
      if (name !== null && BUILDERS.has(name)) {
        return node.arguments.length === 1 ? { kind: 'wrap', arg: first } : { kind: 'builder' };
      }
      if (name === 'normalize' || REALPATH.has(fsFunction(node.callee, current) ?? '')) {
        return { kind: 'wrap', arg: first };
      }
      return null;
    };

    /**
     * The call a sink's path was resolved by: walking back through bindings
     * and value-keeping calls, the nearest `join` / `resolve` of several
     * segments, or else the earliest value-keeping call. Null when the path
     * was not resolved.
     */
    const resolvedRoot = (node: TSESTree.Node, current: PathBindings): TSESTree.Node | null => {
      let value: TSESTree.Node = node;
      let root: TSESTree.Node | null = null;
      for (let depth = 0; depth < MAX_DEPTH * 2; depth += 1) {
        const inner = peel(value);
        if (inner.type === AST_NODE_TYPES.Identifier) {
          // A `let` written once in a callback or a destructured literal holds it too.
          const init = singleInitializer(inner, sourceCode) ?? flowStep(inner, inner, sourceCode)?.node ?? null;
          if (init === null) {
            return root;
          }
          value = init;
          continue;
        }
        const step = pathStep(inner, current);
        if (step === null) {
          return root;
        }
        if (step.kind === 'builder') {
          return inner;
        }
        root = inner;
        value = step.arg;
      }
      return root;
    };

    /** True when `parent` hands `child`'s path value on unchanged. */
    const keepsValue = (parent: TSESTree.Node, child: TSESTree.Node, current: PathBindings): boolean => {
      switch (parent.type) {
        case AST_NODE_TYPES.TSAsExpression:
        case AST_NODE_TYPES.TSNonNullExpression:
        case AST_NODE_TYPES.TSSatisfiesExpression:
        case AST_NODE_TYPES.TSTypeAssertion:
        case AST_NODE_TYPES.AwaitExpression:
        case AST_NODE_TYPES.ChainExpression:
          return true;
        default: {
          const step = pathStep(parent, current);
          return step?.kind === 'wrap' && step.arg === child;
        }
      }
    };

    /**
     * The `let` that `parent` writes `child` into when that is its only write
     * (`let p; [x].forEach((v) => { p = resolve(base, v); })`), else undefined.
     */
    const writtenOnceBy = (parent: TSESTree.Node | undefined, child: TSESTree.Node): Variable | undefined => {
      if (
        parent?.type !== AST_NODE_TYPES.AssignmentExpression ||
        parent.operator !== '=' ||
        parent.right !== child ||
        parent.left.type !== AST_NODE_TYPES.Identifier
      ) {
        return undefined;
      }
      const variable = ASTUtils.findVariable(sourceCode.getScope(parent.left), parent.left);
      return variable !== null && flowStep(parent.left, parent.left, sourceCode)?.node === child
        ? variable
        : undefined;
    };

    /**
     * Every node holding the resolved value: the root call, and the reads of
     * each binding it is stored in through value-keeping calls, transitively.
     * Null when one of those bindings is reassigned.
     */
    const resolvedValues = (root: TSESTree.Node, current: PathBindings): Set<TSESTree.Node> | null => {
      const nodes = new Set<TSESTree.Node>([root]);
      const queue: TSESTree.Node[] = [root];
      const seen = new Set<Variable>();
      for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
        let child: TSESTree.Node = node;
        let parent = node.parent;
        while (parent != null && keepsValue(parent, child, current)) {
          child = parent;
          parent = parent.parent;
        }
        const variable =
          parent?.type === AST_NODE_TYPES.VariableDeclarator &&
          parent.init === child &&
          parent.id.type === AST_NODE_TYPES.Identifier
            ? sourceCode.getDeclaredVariables(parent)[0]
            : writtenOnceBy(parent, child);
        if (variable === undefined || seen.has(variable)) {
          continue;
        }
        if (
          variable.references.some(
            (reference) =>
              reference.isWrite() && reference.init !== true && reference.identifier.parent !== parent,
          )
        ) {
          return null;
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
    };

    // -----------------------------------------------------------------------
    // Containment tests (shared with electron `no-renderer-setting-to-fs`)
    // -----------------------------------------------------------------------

    /** True when `node` holds the resolved value, directly or through a value-keeping call. */
    const holdsResolved = (
      raw: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      let node = peel(raw);
      for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
        if (values.has(node)) {
          return true;
        }
        const step = pathStep(node, current);
        if (step?.kind !== 'wrap') {
          return false;
        }
        node = peel(step.arg);
      }
      return false;
    };

    /** A configured guard call that takes the resolved value (`isInside(base, resolved)`). */
    const guardCall = (
      term: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      const node = peel(term);
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return false;
      }
      const callee = peel(node.callee);
      const name =
        callee.type === AST_NODE_TYPES.Identifier
          ? callee.name
          : callee.type === AST_NODE_TYPES.MemberExpression
            ? propertyName(callee)
            : null;
      return (
        name !== null && guards.has(name) && node.arguments.some((arg) => holdsResolved(arg, values, current))
      );
    };

    /** What the shared matcher needs to know about the value `values` hold. */
    const containmentContext = (
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): PathContainmentContext => ({
      sourceCode,
      pathFunction: (callee) => pathFunction(callee, current),
      isPathSep: (node) => isPathSep(node, current),
      holdsResolved: (node) => holdsResolved(node, values, current),
      // A base the requester picks proves nothing.
      fixedBase: (node) => requestSourceOf(node, node, taintFor(current), sourceCode) === null,
      isGuardCall: (node) => guardCall(node, values, current),
    });

    /** True when a containment test on `values` decides whether `node` runs. */
    const guardedAt = (node: TSESTree.Node, values: ReadonlySet<TSESTree.Node>, current: PathBindings): boolean => {
      const shared = containmentContext(values, current);
      const guard = containmentGuard(shared);
      return (
        isGuardedBefore(node, guard, sourceCode) ||
        isGuardedByLogicalBefore(node, guard, sourceCode) ||
        isAssertedBefore(node, shared)
      );
    };

    /** True when a containment test on the value `root` resolved decides whether `sink` runs. */
    const containedAt = (root: TSESTree.Node, sink: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      return values !== null && guardedAt(sink, values, current);
    };

    /**
     * True when a containment test on the value `root` resolved decides
     * whether some later read of it runs (the join check), or exits the
     * function's block when it is outside: a test whose result is ignored,
     * guards other code or sits in a nested function does not.
     */
    const guardsAUse = (root: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      if (values === null) {
        return false;
      }
      if ([...values].some((node) => node !== root && guardedAt(node, values, current))) {
        return true;
      }
      const guard = containmentGuard(containmentContext(values, current));
      const owner = enclosingFunction(root);
      return walkSome(
        scopeOf(root),
        sourceCode.visitorKeys,
        (candidate) =>
          candidate.type === AST_NODE_TYPES.IfStatement &&
          candidate.range[0] > root.range[1] &&
          enclosingFunction(candidate) === owner &&
          isExitGuard(candidate, guard, sourceCode),
      );
    };

    /**
     * True when the function holding `root` has a containment test of its
     * value anywhere, whatever decides on its result. Only used to report each
     * unchecked value once: with no test at all, at the join; with a test
     * that guards nothing, at each fs sink it reaches (`feedsFsSink`).
     */
    const testedAnywhere = (root: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      if (values === null) {
        return false;
      }
      const shared = containmentContext(values, current);
      return walkSome(
        scopeOf(root),
        sourceCode.visitorKeys,
        (candidate) =>
          (candidate.type === AST_NODE_TYPES.CallExpression ||
            candidate.type === AST_NODE_TYPES.LogicalExpression ||
            candidate.type === AST_NODE_TYPES.UnaryExpression) &&
          (holdsInside(candidate, shared) || failsOutside(candidate, shared)),
      );
    };

    /** True when a read of the value `root` resolved is part of the path of an fs sink. */
    const feedsFsSink = (root: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      if (values === null) {
        return false;
      }
      return [...values].some((value) => {
        const chain: TSESTree.Node[] = [];
        for (let node: TSESTree.Node | undefined = value; node != null; node = node.parent) {
          if (
            node.type === AST_NODE_TYPES.FunctionDeclaration ||
            node.type === AST_NODE_TYPES.FunctionExpression ||
            node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            node.type.endsWith('Statement') ||
            node.type.endsWith('Declaration')
          ) {
            return false;
          }
          if (node.type === AST_NODE_TYPES.CallExpression) {
            const paths = sinkPaths(node, current).groups.flat();
            if (paths.some((path) => chain.includes(path))) {
              return true;
            }
          }
          chain.push(node);
        }
        return false;
      });
    };

    /** True when the join check reports `root` (see `testedAnywhere`). */
    const reportedAtJoin = (root: TSESTree.Node, current: PathBindings): boolean =>
      !testedAnywhere(root, current) || (!guardsAUse(root, current) && !feedsFsSink(root, current));

    // -----------------------------------------------------------------------
    // Sinks
    // -----------------------------------------------------------------------

    const taintFor = (current: PathBindings): TaintOptions => {
      if (taintOptions !== null) {
        return taintOptions;
      }
      const modules = [...current.modules];
      const named = (fn: string): string[] =>
        [...current.pathFunctions].filter(([, imported]) => imported === fn).map(([local]) => local);
      taintOptions = {
        requestObjects,
        handlerRequests: true,
        context: 'path',
        // `extname` keeps only the last `.ext` of the base name: never `..`, no separator.
        sanitizers: new Set([
          ...named('extname'),
          ...modules.map((name) => `${name}.extname`),
          ...(options.sanitizers ?? []).map((name) => name.replace(/\s+/gu, '').replace(/\(\)$/u, '')),
        ]),
        segmentSanitizers: new Set([...named('basename'), ...modules.map((name) => `${name}.basename`)]),
        preservingCalls: new Set(
          ['join', 'resolve', 'normalize'].flatMap((fn) => [
            ...named(fn),
            ...modules.map((name) => `${name}.${fn}`),
          ]),
        ),
      };
      return taintOptions;
    };

    /** The taint options for a sink: one that acts on a directory also needs a segment refused as empty. */
    const taintForSink = (method: string, current: PathBindings): TaintOptions =>
      actsOnDirectory(method) ? { ...taintFor(current), refuseEmptySegment: true } : taintFor(current);

    /**
     * The input that reaches the path argument `pathArgument` of `sink`
     * unchecked, or null. With `helperParameters`, those bindings are the
     * input followed instead of request objects.
     */
    const uncheckedSource = (
      pathArgument: TSESTree.Node,
      sink: TSESTree.CallExpression,
      method: string,
      current: PathBindings,
      helperParameters?: ReadonlySet<Variable>,
    ): TSESTree.Node | null => {
      const root = resolvedRoot(pathArgument, current);
      if (root !== null) {
        if (containedAt(root, sink, current)) {
          return null;
        }
        // A direct request argument of a join is already reported at the join.
        if (
          helperParameters === undefined &&
          root.type === AST_NODE_TYPES.CallExpression &&
          pathStep(root, current)?.kind === 'builder' &&
          requestSource(root, requestObjects, sourceCode) !== null &&
          !testedAnywhere(root, current)
        ) {
          return null;
        }
      }
      // A resolved path read further on (`[full][0]`, `{ value: full }.value`) keeps its test.
      const contained = (node: TSESTree.Identifier): boolean => {
        const held = resolvedRoot(node, current);
        return held !== null && containedAt(held, sink, current);
      };
      const base = { ...taintForSink(method, current), contained };
      const taint: TaintOptions =
        helperParameters === undefined
          ? base
          : { ...base, requestObjects: new Set(), sourceVariables: helperParameters };
      return requestSourceOf(pathArgument, sink, taint, sourceCode);
    };

    /**
     * True for a root that confines nothing: `'/'`, `''` (Express then
     * serves the path as is), `null` or `undefined`, `path.sep`, the working
     * directory (`'.'`, `'.//'`, `process.cwd()`, `path.resolve()`, a
     * `resolve` / `join` / `normalize` of such parts only), or an
     * environment variable that may be unset or empty.
     */
    const isWeakRoot = (raw: TSESTree.Node, current: PathBindings, depth = 0): boolean => {
      if (depth > MAX_DEPTH) {
        return false;
      }
      const node = peel(raw);
      switch (node.type) {
        case AST_NODE_TYPES.Literal:
          return node.value === null || (typeof node.value === 'string' && isWeakRootText(node.value));
        case AST_NODE_TYPES.TemplateLiteral:
          return node.expressions.length === 0 && isWeakRootText(node.quasis[0]?.value.cooked ?? '');
        case AST_NODE_TYPES.CallExpression: {
          if (isProcessCwd(node, sourceCode)) {
            return true;
          }
          // `path.resolve()`, `path.resolve('.')`, `path.join(process.cwd())`: built only from weak parts.
          const fn = pathFunction(node.callee, current);
          return (
            (fn === 'resolve' || fn === 'join' || fn === 'normalize') &&
            (fn === 'resolve' || node.arguments.length > 0) &&
            node.arguments.every(
              (arg) => arg.type !== AST_NODE_TYPES.SpreadElement && isWeakRoot(arg, current, depth + 1),
            )
          );
        }
        case AST_NODE_TYPES.Identifier: {
          if (node.name === 'undefined') {
            const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
            if (variable === null || variable.defs.length === 0) {
              return true;
            }
          }
          const init = singleInitializer(node, sourceCode);
          return init !== null && isWeakRoot(init, current, depth + 1);
        }
        case AST_NODE_TYPES.MemberExpression:
          return isPathSep(node, current) || isProcessEnvRead(node);
        case AST_NODE_TYPES.LogicalExpression:
          // `env.X || '/srv'` falls back when unset or empty; `env.X ?? '/srv'` keeps an empty one.
          return (
            isWeakRoot(node.right, current, depth + 1) ||
            (node.operator !== '||' && isWeakRoot(node.left, current, depth + 1))
          );
        case AST_NODE_TYPES.ConditionalExpression:
          return isWeakRoot(node.consequent, current, depth + 1) || isWeakRoot(node.alternate, current, depth + 1);
        default:
          return false;
      }
    };

    /** `process.env.X` or `process.env['X']`. */
    const isProcessEnvRead = (node: TSESTree.MemberExpression): boolean => {
      const owner = peel(node.object);
      if (owner.type !== AST_NODE_TYPES.MemberExpression || propertyName(owner) !== 'env') {
        return false;
      }
      const root = peel(owner.object);
      if (root.type !== AST_NODE_TYPES.Identifier || root.name !== 'process') {
        return false;
      }
      const variable = ASTUtils.findVariable(sourceCode.getScope(root), root);
      return variable === null || variable.defs.length === 0;
    };

    /**
     * The path arguments of a filesystem call to check, in groups that report
     * once: a root that confines nothing is checked together with the file it
     * serves.
     */
    const sinkPaths = (
      node: TSESTree.CallExpression,
      current: PathBindings,
    ): { method: string; groups: TSESTree.Node[][] } => {
      const { method, paths, confines } = fsPathArguments(node, current, isResponse);
      const groups: TSESTree.Node[][] = [];
      const seen = new Set<TSESTree.Node>();
      for (const path of paths) {
        const file = confines.get(path);
        const group = file !== undefined && isWeakRoot(path, current) ? [path, file] : [path];
        const fresh = group.filter((member) => !seen.has(member));
        fresh.forEach((member) => seen.add(member));
        if (fresh.length > 0) {
          groups.push(fresh);
        }
      }
      return { method, groups };
    };

    const checkFsCall = (node: TSESTree.CallExpression, current: PathBindings): void => {
      const { method, groups } = sinkPaths(node, current);
      // `realpath` whose result is then tested is how containment is checked
      // against symbolic links, not a use of the path.
      if (REALPATH.has(method) && guardsAUse(node, current)) {
        return;
      }
      for (const group of groups) {
        for (const pathArgument of group) {
          const source = uncheckedSource(pathArgument, node, method, current);
          if (source === null || hatched(node)) {
            continue;
          }
          context.report({
            node: pathArgument,
            messageId: 'unguardedFsPath',
            data: { source: sourceCode.getText(source), method },
          });
          break;
        }
      }
    };

    /**
     * For a local function, the parameters it passes unchecked to an fs sink
     * path, by position, with the fs function they reach. For a destructured
     * parameter, `keys` names the top-level properties whose bindings reach it
     * (null: the whole argument).
     */
    const helperSinks = (fn: FunctionNode, current: PathBindings): Map<number, HelperSink> => {
      const cached = helperCache.get(fn);
      if (cached !== undefined) {
        return cached;
      }
      const result = new Map<number, HelperSink>();
      helperCache.set(fn, result);
      const parameters = new Map<Variable, { index: number; key: string | null }>();
      const declared = sourceCode.getDeclaredVariables(fn);
      fn.params.forEach((param, index) => {
        const id = param.type === AST_NODE_TYPES.AssignmentPattern ? param.left : param;
        if (id.type === AST_NODE_TYPES.Identifier) {
          // A request object parameter is reported inside the function already.
          const variable = requestObjects.has(id.name)
            ? undefined
            : declared.find((candidate) => candidate.name === id.name);
          if (variable !== undefined) {
            parameters.set(variable, { index, key: null });
          }
          return;
        }
        // `function read({ name })`, `([first])`: every binding the pattern declares.
        for (const variable of declared) {
          const name = variable.defs[0]?.name;
          if (
            name?.type !== AST_NODE_TYPES.Identifier ||
            name.range[0] < id.range[0] ||
            name.range[1] > id.range[1] ||
            isRequestFieldParameter(variable)
          ) {
            continue;
          }
          parameters.set(variable, { index, key: topLevelKey(id, name) });
        }
      });
      if (parameters.size === 0) {
        return result;
      }
      walkSome(fn.body, sourceCode.visitorKeys, (candidate) => {
        if (candidate.type !== AST_NODE_TYPES.CallExpression || hatched(candidate)) {
          return false;
        }
        const { method, groups } = sinkPaths(candidate, current);
        for (const pathArgument of groups.flat()) {
          // One parameter at a time: a path built from two of them names both.
          for (const [variable, { index, key }] of parameters) {
            const found = result.get(index);
            if (found !== undefined && (found.keys === null || (key !== null && found.keys.has(key)))) {
              continue;
            }
            const source = uncheckedSource(pathArgument, candidate, method, current, new Set([variable]));
            if (
              source?.type !== AST_NODE_TYPES.Identifier ||
              ASTUtils.findVariable(sourceCode.getScope(source), source) !== variable
            ) {
              continue;
            }
            const keys = key === null || found?.keys === null ? null : new Set([...(found?.keys ?? []), key]);
            result.set(index, { method: found?.method ?? method, keys });
          }
        }
        return false;
      });
      return result;
    };

    /**
     * The local function a callee names: a declaration, or a `const` (or a
     * `let` / `var` written only by its declaration) holding a function.
     */
    const localFunction = (callee: TSESTree.Node): FunctionNode | null => {
      const inner = peel(callee);
      if (inner.type !== AST_NODE_TYPES.Identifier) {
        return null;
      }
      const variable = ASTUtils.findVariable(sourceCode.getScope(inner), inner);
      const def = variable?.defs[0];
      if (variable == null || variable.defs.length !== 1 || def === undefined) {
        return null;
      }
      if (def.type === 'FunctionName' && def.node.type === AST_NODE_TYPES.FunctionDeclaration) {
        return def.node;
      }
      if (
        def.type !== 'Variable' ||
        def.node.init == null ||
        variable.references.some((reference) => reference.isWrite() && reference.init !== true)
      ) {
        return null;
      }
      const init = peel(def.node.init);
      return init.type === AST_NODE_TYPES.FunctionExpression ||
        init.type === AST_NODE_TYPES.ArrowFunctionExpression
        ? init
        : null;
    };

    /**
     * The parts of a helper argument that reach its sink: for an object
     * literal passed to a destructured parameter, the values of the keys that
     * reach it; else the whole argument.
     */
    const reachingParts = (arg: TSESTree.Expression, keys: ReadonlySet<string> | null): TSESTree.Node[] => {
      const inner = peel(arg);
      if (
        keys === null ||
        inner.type !== AST_NODE_TYPES.ObjectExpression ||
        inner.properties.some(
          (property) =>
            property.type !== AST_NODE_TYPES.Property ||
            (property.computed && property.key.type !== AST_NODE_TYPES.Literal),
        )
      ) {
        return [arg];
      }
      return inner.properties.flatMap((property) => {
        if (property.type !== AST_NODE_TYPES.Property) {
          return [];
        }
        const name =
          property.key.type === AST_NODE_TYPES.Identifier && !property.computed
            ? property.key.name
            : property.key.type === AST_NODE_TYPES.Literal
              ? String(property.key.value)
              : null;
        return name !== null && keys.has(name) ? [property.value] : [];
      });
    };

    const checkHelperCall = (node: TSESTree.CallExpression, current: PathBindings): void => {
      const fn = localFunction(node.callee);
      if (fn === null || fn === enclosingFunction(node)) {
        return;
      }
      for (const [index, { method, keys }] of helperSinks(fn, current)) {
        const arg = node.arguments[index];
        if (arg === undefined || arg.type === AST_NODE_TYPES.SpreadElement) {
          continue;
        }
        for (const part of reachingParts(arg, keys)) {
          const source = requestSourceOf(part, node, taintForSink(method, current), sourceCode);
          if (source === null || hatched(node)) {
            continue;
          }
          context.report({
            node: arg,
            messageId: 'unguardedFsHelper',
            data: { source: sourceCode.getText(source), helper: sourceCode.getText(node.callee), method },
          });
          break;
        }
      }
    };

    return {
      Program(program): void {
        bindings = collectPathBindings(program, sourceCode.visitorKeys);
      },
      CallExpression(node): void {
        if (bindings === null) {
          return;
        }
        checkFsCall(node, bindings);
        checkHelperCall(node, bindings);
        const method = pathFunction(node.callee, bindings);
        if (method === null || !BUILDERS.has(method)) {
          return;
        }
        const source = requestSource(node, requestObjects, sourceCode);
        if (source === null || !reportedAtJoin(node, bindings) || hatched(node)) {
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
