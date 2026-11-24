import {
  AST_NODE_TYPES,
  enclosingFunction,
  walkSome,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';
import { ASTUtils } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
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
import { requestSourceOf, type TaintOptions } from '../request-taint';
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
 * argument `resolve` or `join`, or `realpath`): `full.startsWith(base + sep)`
 * (the base must end in a separator, or `/srv/app-evil` passes a test for
 * `/srv/app`), a `path.relative(base, full)` result refused when it starts
 * with `..` and when it is absolute (on Windows `relative` returns an absolute
 * path across drives), or a configured guard function `isInside(base, full)`.
 * A test of some other string (`name.startsWith('.')`) is not. An escape-hatch
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
 *  - it passes through `path.basename` into a binding that is refused as `..`
 *    before the sink (`basename('..')` is `'..'`, so a bare `basename` is not
 *    containment);
 *  - the path is resolved and one of the tests above runs before the sink on
 *    every path to it (an `if` that exits, or an `if` around the sink). A test
 *    that only runs somewhere in the function does not count here.
 * `res.sendFile(p, { root })` is checked on the root: Express refuses a `..`
 * segment of `p` (after decoding it) and serves it under the root.
 *
 * HELPERS. A call to a local function that forwards one of its parameters to
 * an fs sink path with no containment check is reported at the call when
 * request input reaches that argument. One level only: a helper that passes
 * the path on to another helper is not followed.
 *
 * NOT MODELLED. Symbolic links (a contained path can still point outside;
 * compare `fs.realpath` results for that), `path.posix` / `path.win32` (never
 * read as containment), and helpers more than one call deep.
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
    for (const step of flowSteps(arg, call, sourceCode)) {
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

function flatten(node: TSESTree.Node, operator: '&&' | '||'): TSESTree.Node[] {
  const inner = peel(node);
  if (inner.type === AST_NODE_TYPES.LogicalExpression && inner.operator === operator) {
    return [...flatten(inner.left, operator), ...flatten(inner.right, operator)];
  }
  return [inner];
}

/** `!x` as `x`, else null. */
function negation(node: TSESTree.Node): TSESTree.Node | null {
  const inner = peel(node);
  return inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!'
    ? peel(inner.argument)
    : null;
}

/** The single written binding of a `const` or never reassigned `let`, with its initializer. */
function singleInit(node: TSESTree.Identifier, sourceCode: SourceCode): TSESTree.Expression | null {
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  if (
    variable == null ||
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    def.node.init == null ||
    variable.references.some((reference) => reference.isWrite() && reference.init !== true)
  ) {
    return null;
  }
  return def.node.init;
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
        '`{{source}}` (request-shaped input) reaches the path of `{{method}}(...)` with no containment check, a path-traversal sink. Check the value against an allowlist or an anchored regex that cannot match `.` or `..` (`/^[\\w-][\\w.-]*$/`), refuse `.` and `..` after `path.basename(...)`, or resolve the path and verify it stays under the base dir (`resolved.startsWith(baseDir + sep)`) before the call. If this path is already safe, add a `// path-containment: <reason>` comment.',
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
    const helperCache = new Map<FunctionNode, Map<number, string>>();

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
          const init = singleInit(inner, sourceCode) ?? flowStep(inner, inner, sourceCode)?.node ?? null;
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
    // Containment tests
    // -----------------------------------------------------------------------

    /**
     * True for a string that is a base followed by a separator: `base + sep`,
     * `` `${base}/` ``, `'/srv/app/'`. A separator alone (`sep`, `'/'`) is not:
     * every absolute path starts with it.
     */
    const endsInSeparator = (
      raw: TSESTree.Node,
      current: PathBindings,
      whole = true,
      depth = 0,
    ): boolean => {
      if (depth > MAX_DEPTH) {
        return false;
      }
      const node = peel(raw);
      if (isPathSep(node, current)) {
        return !whole;
      }
      if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
        return node.value.length > (whole ? 1 : 0) && /[\\/]$/u.test(node.value);
      }
      if (node.type === AST_NODE_TYPES.TemplateLiteral) {
        const tail = node.quasis.at(-1)?.value.cooked ?? '';
        const last = node.expressions.at(-1);
        const sepAtEnd =
          tail !== '' ? /[\\/]$/u.test(tail) : last !== undefined && isPathSep(last, current);
        // Text before the separator: an earlier expression, or literal text.
        const head = node.quasis
          .map((quasi) => quasi.value.cooked ?? '')
          .join('')
          .replace(/[\\/]$/u, '');
        const before = node.expressions.length - (tail === '' ? 1 : 0) > 0 || head !== '';
        return sepAtEnd && (before || !whole);
      }
      if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
        const left = peel(node.left);
        const emptyLeft =
          (left.type === AST_NODE_TYPES.Literal && left.value === '') ||
          (left.type === AST_NODE_TYPES.TemplateLiteral &&
            left.expressions.length === 0 &&
            left.quasis[0]?.value.cooked === '');
        return !emptyLeft && endsInSeparator(node.right, current, false, depth + 1);
      }
      if (node.type === AST_NODE_TYPES.Identifier) {
        const init = singleInit(node, sourceCode);
        return init !== null && endsInSeparator(init, current, whole, depth + 1);
      }
      return false;
    };

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

    /** `x.<method>(arg)` as its receiver and argument, else null. */
    const methodCall = (
      raw: TSESTree.Node,
      method: string,
    ): { receiver: TSESTree.Node; arg: TSESTree.Node } | null => {
      const node = peel(raw);
      if (node.type !== AST_NODE_TYPES.CallExpression || node.arguments.length !== 1) {
        return null;
      }
      const callee = peel(node.callee);
      const arg = node.arguments[0];
      return callee.type === AST_NODE_TYPES.MemberExpression &&
        propertyName(callee) === method &&
        arg !== undefined &&
        arg.type !== AST_NODE_TYPES.SpreadElement
        ? { receiver: callee.object, arg }
        : null;
    };

    /** True when no request input reaches `node` (a base the requester picks proves nothing). */
    const fixedBase = (node: TSESTree.Node, current: PathBindings): boolean =>
      requestSourceOf(node, node, taintFor(current), sourceCode) === null;

    /** `resolved.startsWith(base + sep)`, with a base the requester does not pick. */
    const startsWithBase = (
      term: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      const call = methodCall(term, 'startsWith');
      return (
        call !== null &&
        holdsResolved(call.receiver, values, current) &&
        endsInSeparator(call.arg, current) &&
        fixedBase(call.arg, current)
      );
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

    /**
     * What a `relative(base, resolved)` result is read through: the call itself
     * (`'inline'`) or the binding it is stored in. Null for anything else.
     */
    const relativeOf = (
      raw: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): Variable | 'inline' | null => {
      const node = peel(raw);
      const isRelative = (candidate: TSESTree.Node): boolean => {
        const inner = peel(candidate);
        return (
          inner.type === AST_NODE_TYPES.CallExpression &&
          pathFunction(inner.callee, current) === 'relative' &&
          inner.arguments[0] !== undefined &&
          inner.arguments[1] !== undefined &&
          holdsResolved(inner.arguments[1], values, current) &&
          fixedBase(inner.arguments[0], current)
        );
      };
      if (isRelative(node)) {
        return 'inline';
      }
      if (node.type !== AST_NODE_TYPES.Identifier) {
        return null;
      }
      const init = singleInit(node, sourceCode);
      return init !== null && isRelative(init)
        ? (ASTUtils.findVariable(sourceCode.getScope(node), node) ?? null)
        : null;
    };

    /** `rel.startsWith('..')` or `rel.includes('..')`: the relative result it reads, else null. */
    const refusesParent = (
      term: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): Variable | 'inline' | null => {
      for (const method of ['startsWith', 'includes']) {
        const call = methodCall(term, method);
        const arg = call === null ? null : peel(call.arg);
        if (call !== null && arg?.type === AST_NODE_TYPES.Literal && arg.value === '..') {
          return relativeOf(call.receiver, values, current);
        }
      }
      return null;
    };

    /** `isAbsolute(rel)`: the relative result it reads, else null. */
    const refusesAbsolute = (
      term: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): Variable | 'inline' | null => {
      const node = peel(term);
      if (
        node.type !== AST_NODE_TYPES.CallExpression ||
        pathFunction(node.callee, current) !== 'isAbsolute' ||
        node.arguments[0] === undefined
      ) {
        return null;
      }
      return relativeOf(node.arguments[0], values, current);
    };

    /** True when the same relative result is refused both when it climbs and when it is absolute. */
    const refusesBoth = (
      terms: readonly TSESTree.Node[],
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      const parents = terms.map((term) => refusesParent(term, values, current)).filter((key) => key !== null);
      return terms.some((term) => {
        const key = refusesAbsolute(term, values, current);
        return key !== null && parents.includes(key);
      });
    };

    /**
     * A test that is true whenever the resolved value is outside the base:
     * `!full.startsWith(base + sep)`, `!isInside(base, full)`, or
     * `rel.startsWith('..') || isAbsolute(rel)`.
     */
    const failsOutside = (
      test: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      const terms = flatten(test, '||');
      return (
        terms.some((term) => {
          const inner = negation(term);
          return inner !== null && (startsWithBase(inner, values, current) || guardCall(inner, values, current));
        }) || refusesBoth(terms, values, current)
      );
    };

    /** A test that is true only when the resolved value is inside the base. */
    const holdsInside = (
      test: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      const terms = flatten(test, '&&');
      if (terms.some((term) => startsWithBase(term, values, current) || guardCall(term, values, current))) {
        return true;
      }
      const negated = terms.map(negation).filter((term): term is TSESTree.Node => term !== null);
      return refusesBoth(negated, values, current);
    };

    /** A configured guard called as a statement before `sink` (`assertInside(base, full)`). */
    const assertedBefore = (
      sink: TSESTree.Node,
      values: ReadonlySet<TSESTree.Node>,
      current: PathBindings,
    ): boolean => {
      let child: TSESTree.Node = sink;
      for (let parent = sink.parent; parent != null; child = parent, parent = parent.parent) {
        if (
          parent.type === AST_NODE_TYPES.FunctionDeclaration ||
          parent.type === AST_NODE_TYPES.FunctionExpression ||
          parent.type === AST_NODE_TYPES.ArrowFunctionExpression
        ) {
          return false;
        }
        if (parent.type !== AST_NODE_TYPES.BlockStatement && parent.type !== AST_NODE_TYPES.Program) {
          continue;
        }
        const body: readonly TSESTree.Node[] = parent.body;
        const index = body.indexOf(child);
        for (const statement of body.slice(0, Math.max(index, 0))) {
          if (
            statement.type === AST_NODE_TYPES.ExpressionStatement &&
            guardCall(statement.expression, values, current)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    /** True when a containment test on the value `root` resolved runs before `sink` on every path. */
    const containedAt = (root: TSESTree.Node, sink: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      if (values === null) {
        return false;
      }
      return (
        isGuardedBefore(
          sink,
          (test, negated) =>
            negated ? failsOutside(test, values, current) : holdsInside(test, values, current),
          sourceCode,
        ) || assertedBefore(sink, values, current)
      );
    };

    /** True when the function holding `root` tests its value anywhere (the join check). */
    const testedAnywhere = (root: TSESTree.Node, current: PathBindings): boolean => {
      const values = resolvedValues(root, current);
      if (values === null) {
        return false;
      }
      const terms: TSESTree.Node[] = [];
      const found = walkSome(scopeOf(root), sourceCode.visitorKeys, (candidate) => {
        if (candidate.type !== AST_NODE_TYPES.CallExpression) {
          return false;
        }
        terms.push(candidate);
        return startsWithBase(candidate, values, current) || guardCall(candidate, values, current);
      });
      return found || refusesBoth(terms, values, current);
    };

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

    /**
     * The input that reaches the path argument `pathArgument` of `sink`
     * unchecked, or null. With `helperParameters`, those bindings are the
     * input followed instead of request objects.
     */
    const uncheckedSource = (
      pathArgument: TSESTree.Node,
      sink: TSESTree.CallExpression,
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
      const base = taintFor(current);
      const taint: TaintOptions =
        helperParameters === undefined
          ? base
          : { ...base, requestObjects: new Set(), sourceVariables: helperParameters };
      return requestSourceOf(pathArgument, sink, taint, sourceCode);
    };

    const checkFsCall = (node: TSESTree.CallExpression, current: PathBindings): void => {
      const { method, paths } = fsPathArguments(node, current, isResponse);
      // `realpath` whose result is then tested is how containment is checked
      // against symbolic links, not a use of the path.
      if (REALPATH.has(method) && testedAnywhere(node, current)) {
        return;
      }
      for (const pathArgument of paths) {
        const source = uncheckedSource(pathArgument, node, current);
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

    /**
     * For a local function, the parameters it passes unchecked to an fs sink
     * path, by position, with the fs function they reach.
     */
    const helperSinks = (fn: FunctionNode, current: PathBindings): Map<number, string> => {
      const cached = helperCache.get(fn);
      if (cached !== undefined) {
        return cached;
      }
      const result = new Map<number, string>();
      helperCache.set(fn, result);
      const parameters = new Map<Variable, number>();
      fn.params.forEach((param, index) => {
        const id = param.type === AST_NODE_TYPES.AssignmentPattern ? param.left : param;
        // A request object parameter is reported inside the function already.
        if (id.type === AST_NODE_TYPES.Identifier && !requestObjects.has(id.name)) {
          const variable = sourceCode.getDeclaredVariables(fn).find((candidate) => candidate.name === id.name);
          if (variable !== undefined) {
            parameters.set(variable, index);
          }
        }
      });
      if (parameters.size === 0) {
        return result;
      }
      walkSome(fn.body, sourceCode.visitorKeys, (candidate) => {
        if (candidate.type !== AST_NODE_TYPES.CallExpression || hatched(candidate)) {
          return false;
        }
        const { method, paths } = fsPathArguments(candidate, current, isResponse);
        for (const pathArgument of paths) {
          // One parameter at a time: a path built from two of them names both.
          for (const [variable, index] of parameters) {
            const source = result.has(index)
              ? null
              : uncheckedSource(pathArgument, candidate, current, new Set([variable]));
            if (
              source?.type === AST_NODE_TYPES.Identifier &&
              ASTUtils.findVariable(sourceCode.getScope(source), source) === variable
            ) {
              result.set(index, method);
            }
          }
        }
        return false;
      });
      return result;
    };

    /** The local function a callee names (a declaration, or a `const` holding a function). */
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
      if (def.type !== 'Variable' || def.parent.kind !== 'const' || def.node.init == null) {
        return null;
      }
      const init = peel(def.node.init);
      return init.type === AST_NODE_TYPES.FunctionExpression ||
        init.type === AST_NODE_TYPES.ArrowFunctionExpression
        ? init
        : null;
    };

    const checkHelperCall = (node: TSESTree.CallExpression, current: PathBindings): void => {
      const fn = localFunction(node.callee);
      if (fn === null || fn === enclosingFunction(node)) {
        return;
      }
      for (const [index, method] of helperSinks(fn, current)) {
        const arg = node.arguments[index];
        if (arg === undefined || arg.type === AST_NODE_TYPES.SpreadElement) {
          continue;
        }
        const source = requestSourceOf(arg, node, taintFor(current), sourceCode);
        if (source === null || hatched(node)) {
          continue;
        }
        context.report({
          node: arg,
          messageId: 'unguardedFsHelper',
          data: { source: sourceCode.getText(source), helper: sourceCode.getText(node.callee), method },
        });
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
        if (source === null || testedAnywhere(node, bindings) || hatched(node)) {
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
