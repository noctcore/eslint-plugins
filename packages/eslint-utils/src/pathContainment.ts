import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { isFunctionNode } from './ast';

/*
 * Path containment tests, shared by the rules that accept a checked path:
 * which test on a resolved path proves it stays under a base directory, and
 * whether that test decides control flow for a sink.
 *
 * A test counts only when its result guards the sink: an `if` before it that
 * returns, throws, breaks or continues when the path is outside, an `if`,
 * `?:`, `&&` or `||` around it that runs it only when the path is inside, or a
 * configured guard called as a statement before it (one that throws). A test
 * whose result is ignored, one that guards some other statement, and one in a
 * nested function do not count. The tests:
 *
 *  - `full.startsWith(base + sep)`: the argument ends in a separator after
 *    some base text (`base + path.sep`, `` `${base}/` ``, `'/srv/app/'`), or
 *    `/srv/app-evil` passes a test for `/srv/app`;
 *  - `path.relative(base, full)` refused when it climbs (`startsWith('..')`,
 *    or both `=== '..'` and `startsWith('..' + sep)`) and when it is absolute
 *    (`path.isAbsolute`, which `relative` returns across Windows drives);
 *  - a configured guard call that takes the path (`isInside(base, full)`).
 *
 * The base must be one the input cannot pick, and not one every path is under:
 * a bare separator, `''`, `'.'` or `process.cwd()` proves nothing.
 */

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

const MAX_DEPTH = 8;

/** What a rule tells the matcher about the file and the path under test. */
export interface PathContainmentContext {
  readonly sourceCode: SourceCode;
  /** The `path` function a callee names (`relative`, `isAbsolute`, `resolve`), or null. */
  readonly pathFunction: (callee: TSESTree.Node) => string | null;
  /** True for the `path.sep` constant (or an imported `sep`). */
  readonly isPathSep: (node: TSESTree.Node) => boolean;
  /** True when `node` holds the resolved path being checked. */
  readonly holdsResolved: (node: TSESTree.Node) => boolean;
  /** True when the input under test cannot reach `node`, a base. */
  readonly fixedBase: (node: TSESTree.Node) => boolean;
  /** True for a call to a configured guard that takes the path (`isInside(base, full)`). */
  readonly isGuardCall?: (node: TSESTree.Node) => boolean;
}

/** Peels type wrappers, `await` and optional chains, which keep the value. */
function peel(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  for (;;) {
    if (
      current.type === AST_NODE_TYPES.TSAsExpression ||
      current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.type === AST_NODE_TYPES.TSTypeAssertion ||
      current.type === AST_NODE_TYPES.ChainExpression
    ) {
      current = current.expression;
    } else if (current.type === AST_NODE_TYPES.AwaitExpression) {
      current = current.argument;
    } else {
      return current;
    }
  }
}

function memberName(member: TSESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === AST_NODE_TYPES.Identifier) {
    return member.property.name;
  }
  return member.property.type === AST_NODE_TYPES.Literal && typeof member.property.value === 'string'
    ? member.property.value
    : null;
}

/** The initializer of a `const`, or of a `let` written only by its declaration, else null. */
export function singleInitializer(node: TSESTree.Identifier, sourceCode: SourceCode): TSESTree.Expression | null {
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

/** True when `node` names the global `name`, not a local binding that shadows it. */
function isGlobalName(node: TSESTree.Node, name: string, sourceCode: SourceCode): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier || node.name !== name) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  return variable === null || variable.defs.length === 0;
}

/** `process.cwd()`. */
export function isProcessCwd(raw: TSESTree.Node, sourceCode: SourceCode): boolean {
  const node = peel(raw);
  if (node.type !== AST_NODE_TYPES.CallExpression || node.arguments.length > 0) {
    return false;
  }
  const callee = peel(node.callee);
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    memberName(callee) === 'cwd' &&
    isGlobalName(peel(callee.object), 'process', sourceCode)
  );
}

/**
 * True for a base every path of interest is under: a string of separators
 * only, `''` or `'.'` (the working directory for `relative`), `path.sep`,
 * `process.cwd()` and `path.resolve()` with no argument.
 */
export function isBroadBase(raw: TSESTree.Node, context: PathContainmentContext, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const node = peel(raw);
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' && /^(?:\.|[\\/]*)$/u.test(node.value);
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return /^(?:\.|[\\/]*)$/u.test(node.quasis[0]?.value.cooked ?? '');
  }
  if (context.isPathSep(node) || isProcessCwd(node, context.sourceCode)) {
    return true;
  }
  if (node.type === AST_NODE_TYPES.CallExpression && node.arguments.length === 0) {
    return context.pathFunction(node.callee) === 'resolve';
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = singleInitializer(node, context.sourceCode);
    return init !== null && isBroadBase(init, context, depth + 1);
  }
  return false;
}

/**
 * True for a string that is a base followed by a separator: `base + sep`,
 * `` `${base}/` ``, `'/srv/app/'`. A separator alone (`sep`, `'/'`) is not:
 * every absolute path starts with it.
 */
export function endsInSeparator(
  raw: TSESTree.Node,
  context: PathContainmentContext,
  whole = true,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const node = peel(raw);
  if (context.isPathSep(node)) {
    return !whole;
  }
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value.length > (whole ? 1 : 0) && /[\\/]$/u.test(node.value);
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    const tail = node.quasis.at(-1)?.value.cooked ?? '';
    const last = node.expressions.at(-1);
    const sepAtEnd = tail !== '' ? /[\\/]$/u.test(tail) : last !== undefined && context.isPathSep(last);
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
    return !emptyLeft && endsInSeparator(node.right, context, false, depth + 1);
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = singleInitializer(node, context.sourceCode);
    return init !== null && endsInSeparator(init, context, whole, depth + 1);
  }
  return false;
}

/** The base text before the trailing separator of a `startsWith` argument (`base` in `base + sep`). */
function baseBeforeSeparator(raw: TSESTree.Node, context: PathContainmentContext, depth = 0): TSESTree.Node | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  const node = peel(raw);
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
    return node.left;
  }
  if (
    node.type === AST_NODE_TYPES.TemplateLiteral &&
    node.expressions.length >= 1 &&
    node.quasis.slice(0, -1).every((quasi) => quasi.value.cooked === '')
  ) {
    const tail = node.quasis.at(-1)?.value.cooked ?? '';
    // `${base}/` or `${base}${sep}`: the base is the first expression.
    if (/^[\\/]$/u.test(tail) || (tail === '' && node.expressions.length === 2)) {
      return node.expressions[0] ?? null;
    }
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = singleInitializer(node, context.sourceCode);
    return init === null ? null : baseBeforeSeparator(init, context, depth + 1);
  }
  return null;
}

/** `x.<method>(arg)` as its receiver and argument, else null. */
function methodCall(raw: TSESTree.Node, method: string): { receiver: TSESTree.Node; arg: TSESTree.Node } | null {
  const node = peel(raw);
  if (node.type !== AST_NODE_TYPES.CallExpression || node.arguments.length !== 1) {
    return null;
  }
  const callee = peel(node.callee);
  const arg = node.arguments[0];
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    memberName(callee) === method &&
    arg !== undefined &&
    arg.type !== AST_NODE_TYPES.SpreadElement
    ? { receiver: callee.object, arg }
    : null;
}

/** `resolved.startsWith(base + sep)`, with a base the input does not pick and that is not every path. */
export function isStartsWithBase(term: TSESTree.Node, context: PathContainmentContext): boolean {
  const call = methodCall(term, 'startsWith');
  if (
    call === null ||
    !context.holdsResolved(call.receiver) ||
    !endsInSeparator(call.arg, context) ||
    !context.fixedBase(call.arg) ||
    isBroadBase(call.arg, context)
  ) {
    return false;
  }
  const base = baseBeforeSeparator(call.arg, context);
  return base === null || !isBroadBase(base, context);
}

function isGuard(term: TSESTree.Node, context: PathContainmentContext): boolean {
  return context.isGuardCall?.(peel(term)) === true;
}

/**
 * What a `relative(base, resolved)` result is read through: the call itself
 * (`'inline'`) or the binding it is stored in. Null for anything else.
 */
function relativeOf(raw: TSESTree.Node, context: PathContainmentContext): Variable | 'inline' | null {
  const node = peel(raw);
  const isRelative = (candidate: TSESTree.Node): boolean => {
    const inner = peel(candidate);
    if (inner.type !== AST_NODE_TYPES.CallExpression || context.pathFunction(inner.callee) !== 'relative') {
      return false;
    }
    const [base, target] = inner.arguments;
    return (
      base !== undefined &&
      target !== undefined &&
      base.type !== AST_NODE_TYPES.SpreadElement &&
      target.type !== AST_NODE_TYPES.SpreadElement &&
      context.holdsResolved(target) &&
      context.fixedBase(base) &&
      !isBroadBase(base, context)
    );
  };
  if (isRelative(node)) {
    return 'inline';
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const init = singleInitializer(node, context.sourceCode);
  return init !== null && isRelative(init)
    ? (ASTUtils.findVariable(context.sourceCode.getScope(node), node) ?? null)
    : null;
}

function isDots(node: TSESTree.Node): boolean {
  const inner = peel(node);
  return (
    (inner.type === AST_NODE_TYPES.Literal && inner.value === '..') ||
    (inner.type === AST_NODE_TYPES.TemplateLiteral &&
      inner.expressions.length === 0 &&
      inner.quasis[0]?.value.cooked === '..')
  );
}

/** `'..' + sep` or `` `..${sep}` ``. */
function isDotsSeparator(raw: TSESTree.Node, context: PathContainmentContext): boolean {
  const node = peel(raw);
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
    return isDots(node.left) && context.isPathSep(node.right);
  }
  return (
    node.type === AST_NODE_TYPES.TemplateLiteral &&
    node.expressions.length === 1 &&
    node.quasis[0]?.value.cooked === '..' &&
    node.quasis[1]?.value.cooked === '' &&
    context.isPathSep(node.expressions[0] as TSESTree.Node)
  );
}

type ParentRefusal = 'all' | 'exact' | 'nested';
type RelativeKey = Variable | 'inline';
interface Refusal {
  readonly key: RelativeKey;
  readonly kind: ParentRefusal | 'absolute';
}

/**
 * A term that is true when the relative result climbs or is absolute
 * (`rel.startsWith('..')`, `rel === '..'`, `rel.startsWith('..' + sep)`,
 * `isAbsolute(rel)`), with the result it reads; or, with `inside`, a term
 * that is true only when it does not (`rel !== '..'`, `!isAbsolute(rel)`).
 */
function relativeRefusal(raw: TSESTree.Node, context: PathContainmentContext, inside: boolean): Refusal | null {
  const term = peel(raw);
  if (inside) {
    if (term.type === AST_NODE_TYPES.UnaryExpression && term.operator === '!') {
      return relativeRefusal(term.argument, context, false);
    }
    if (term.type === AST_NODE_TYPES.BinaryExpression && (term.operator === '!==' || term.operator === '!=')) {
      return comparedDots(term, context);
    }
    return null;
  }
  if (term.type === AST_NODE_TYPES.BinaryExpression && (term.operator === '===' || term.operator === '==')) {
    return comparedDots(term, context);
  }
  for (const method of ['startsWith', 'includes']) {
    const call = methodCall(term, method);
    if (call === null) {
      continue;
    }
    const kind: ParentRefusal | null = isDots(call.arg)
      ? 'all'
      : method === 'startsWith' && isDotsSeparator(call.arg, context)
        ? 'nested'
        : null;
    const key = kind === null ? null : relativeOf(call.receiver, context);
    return key === null || kind === null ? null : { key, kind };
  }
  if (term.type === AST_NODE_TYPES.CallExpression && context.pathFunction(term.callee) === 'isAbsolute') {
    const arg = term.arguments[0];
    const key = arg === undefined ? null : relativeOf(arg, context);
    return key === null ? null : { key, kind: 'absolute' };
  }
  return null;
}

function comparedDots(term: TSESTree.BinaryExpression, context: PathContainmentContext): Refusal | null {
  if (term.left.type === AST_NODE_TYPES.PrivateIdentifier) {
    return null;
  }
  const other = isDots(term.right) ? term.left : isDots(term.left) ? term.right : null;
  const key = other === null ? null : relativeOf(other, context);
  return key === null ? null : { key, kind: 'exact' };
}

/** True when some relative result is refused both when it climbs and when it is absolute. */
function refusesBoth(refusals: readonly (Refusal | null)[]): boolean {
  const found = refusals.filter((refusal): refusal is Refusal => refusal !== null);
  return found.some((absolute) => {
    if (absolute.kind !== 'absolute') {
      return false;
    }
    const kinds = new Set(found.filter((refusal) => refusal.key === absolute.key).map((refusal) => refusal.kind));
    return kinds.has('all') || (kinds.has('exact') && kinds.has('nested'));
  });
}

function flatten(node: TSESTree.Node, operator: '&&' | '||'): TSESTree.Node[] {
  const inner = peel(node);
  if (inner.type === AST_NODE_TYPES.LogicalExpression && inner.operator === operator) {
    return [...flatten(inner.left, operator), ...flatten(inner.right, operator)];
  }
  return [inner];
}

function negation(node: TSESTree.Node): TSESTree.Node | null {
  const inner = peel(node);
  return inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!' ? peel(inner.argument) : null;
}

/**
 * A test that is true whenever the resolved path is outside the base:
 * `!full.startsWith(base + sep)`, `!isInside(base, full)`, or
 * `rel.startsWith('..') || isAbsolute(rel)`.
 */
export function failsOutside(test: TSESTree.Node, context: PathContainmentContext): boolean {
  const terms = flatten(test, '||');
  return (
    terms.some((term) => {
      const inner = negation(term);
      return inner !== null && (isStartsWithBase(inner, context) || isGuard(inner, context));
    }) || refusesBoth(terms.map((term) => relativeRefusal(term, context, false)))
  );
}

/** A test that is true only when the resolved path is inside the base. */
export function holdsInside(test: TSESTree.Node, context: PathContainmentContext): boolean {
  const terms = flatten(test, '&&');
  return (
    terms.some((term) => isStartsWithBase(term, context) || isGuard(term, context)) ||
    refusesBoth(terms.map((term) => relativeRefusal(term, context, true)))
  );
}

/** The guard predicate for a walker: `negated` asks for a test true when the path is outside. */
export function containmentGuard(
  context: PathContainmentContext,
): (test: TSESTree.Node, negated: boolean) => boolean {
  return (test, negated) => (negated ? failsOutside(test, context) : holdsInside(test, context));
}

function exitsBlock(node: TSESTree.Statement): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.ReturnStatement:
    case AST_NODE_TYPES.ThrowStatement:
    case AST_NODE_TYPES.BreakStatement:
    case AST_NODE_TYPES.ContinueStatement:
      return true;
    case AST_NODE_TYPES.BlockStatement: {
      const last = node.body.at(-1);
      return last !== undefined && exitsBlock(last);
    }
    default:
      return false;
  }
}

/** The function scope node around `node` (a function, or the program). */
function functionOf(node: TSESTree.Node): TSESTree.Node | null {
  for (let current = node.parent; current != null; current = current.parent) {
    if (isFunctionNode(current)) {
      return current;
    }
  }
  return null;
}

/**
 * A guard test read through `!` and a `const` boolean initialised in the same
 * function before `at` (`const ok = full.startsWith(base + sep); if (!ok) return`).
 */
function expandTest(
  raw: TSESTree.Node,
  negated: boolean,
  at: TSESTree.Node,
  sourceCode: SourceCode,
): { test: TSESTree.Node; negated: boolean } {
  let test = peel(raw);
  let flipped = negated;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (test.type === AST_NODE_TYPES.UnaryExpression && test.operator === '!') {
      test = peel(test.argument);
      flipped = !flipped;
      continue;
    }
    if (test.type !== AST_NODE_TYPES.Identifier) {
      break;
    }
    const variable = ASTUtils.findVariable(sourceCode.getScope(test), test);
    const def = variable?.defs[0];
    if (
      variable == null ||
      variable.defs.length !== 1 ||
      def?.type !== 'Variable' ||
      def.parent.kind !== 'const' ||
      def.node.init == null ||
      def.node.id.type !== AST_NODE_TYPES.Identifier ||
      def.node.init.range[0] > at.range[0] ||
      functionOf(def.node) !== functionOf(at)
    ) {
      break;
    }
    test = peel(def.node.init);
  }
  return { test, negated: flipped };
}

/**
 * True for an `if` with no `else` that returns, throws, breaks or continues
 * when its test, read through `!` and `const` booleans, is one `isGuard`
 * accepts as true when the path is outside (`if (!full.startsWith(base + sep)) return`):
 * everything after it in its block runs only for a path inside.
 */
export function isExitGuard(
  statement: TSESTree.Node,
  isGuard: (test: TSESTree.Node, negated: boolean) => boolean,
  sourceCode: SourceCode,
): boolean {
  if (
    statement.type !== AST_NODE_TYPES.IfStatement ||
    statement.alternate !== null ||
    !exitsBlock(statement.consequent)
  ) {
    return false;
  }
  if (isGuard(statement.test, true)) {
    return true;
  }
  const expanded = expandTest(statement.test, true, statement, sourceCode);
  return expanded.test !== peel(statement.test) && isGuard(expanded.test, expanded.negated);
}

/**
 * True when a test `isGuard` accepts decides whether `sink` runs: an `if`
 * before it in an enclosing block that exits when the test holds (`negated`),
 * or an `if`, `?:`, `&&` or `||` around it that runs it only when the test
 * passed. Tests are read through `!` and `const` booleans. Only blocks of the
 * function that holds the sink count: a function can run before the checks
 * around its definition, and a test in another function runs who knows when.
 */
export function isGuardedBefore(
  sink: TSESTree.Node,
  isGuard: (test: TSESTree.Node, negated: boolean) => boolean,
  sourceCode: SourceCode,
): boolean {
  const passes = (test: TSESTree.Node, negated: boolean, at: TSESTree.Node): boolean => {
    if (isGuard(test, negated)) {
      return true;
    }
    const expanded = expandTest(test, negated, at, sourceCode);
    return expanded.test !== peel(test) && isGuard(expanded.test, expanded.negated);
  };
  let child: TSESTree.Node = sink;
  for (let parent = sink.parent; parent != null; child = parent, parent = parent.parent) {
    if (isFunctionNode(parent)) {
      return false;
    }
    if (
      parent.type === AST_NODE_TYPES.BlockStatement ||
      parent.type === AST_NODE_TYPES.Program ||
      parent.type === AST_NODE_TYPES.StaticBlock ||
      parent.type === AST_NODE_TYPES.SwitchCase
    ) {
      const body: readonly TSESTree.Node[] =
        parent.type === AST_NODE_TYPES.SwitchCase ? parent.consequent : parent.body;
      for (const statement of body.slice(0, Math.max(body.indexOf(child), 0))) {
        if (isExitGuard(statement, isGuard, sourceCode)) {
          return true;
        }
      }
    }
    if (parent.type === AST_NODE_TYPES.IfStatement || parent.type === AST_NODE_TYPES.ConditionalExpression) {
      if (child === parent.consequent && passes(parent.test, false, parent)) {
        return true;
      }
      if (child === parent.alternate && passes(parent.test, true, parent)) {
        return true;
      }
    }
    if (isGuardedByLogical(parent, child, passes)) {
      return true;
    }
  }
  return false;
}

function isGuardedByLogical(
  parent: TSESTree.Node,
  child: TSESTree.Node,
  passes: (test: TSESTree.Node, negated: boolean, at: TSESTree.Node) => boolean,
): boolean {
  return (
    parent.type === AST_NODE_TYPES.LogicalExpression &&
    child === parent.right &&
    ((parent.operator === '&&' && passes(parent.left, false, parent)) ||
      (parent.operator === '||' && passes(parent.left, true, parent)))
  );
}

/**
 * True when `sink` is the right side of an `&&` or `||` whose left side
 * decides it runs (`inside && read(full)`, `outside || read(full)`), for
 * rules that walk `if` and `?:` guards on their own.
 */
export function isGuardedByLogicalBefore(
  sink: TSESTree.Node,
  isGuard: (test: TSESTree.Node, negated: boolean) => boolean,
  sourceCode: SourceCode,
): boolean {
  const passes = (test: TSESTree.Node, negated: boolean, at: TSESTree.Node): boolean => {
    if (isGuard(test, negated)) {
      return true;
    }
    const expanded = expandTest(test, negated, at, sourceCode);
    return expanded.test !== peel(test) && isGuard(expanded.test, expanded.negated);
  };
  let child: TSESTree.Node = sink;
  for (let parent = sink.parent; parent != null; child = parent, parent = parent.parent) {
    if (isFunctionNode(parent)) {
      return false;
    }
    if (isGuardedByLogical(parent, child, passes)) {
      return true;
    }
  }
  return false;
}

/** A configured guard called as a statement before `sink` in an enclosing block (`assertInside(base, full)`). */
export function isAssertedBefore(sink: TSESTree.Node, context: PathContainmentContext): boolean {
  let child: TSESTree.Node = sink;
  for (let parent = sink.parent; parent != null; child = parent, parent = parent.parent) {
    if (isFunctionNode(parent)) {
      return false;
    }
    if (parent.type !== AST_NODE_TYPES.BlockStatement && parent.type !== AST_NODE_TYPES.Program) {
      continue;
    }
    const body: readonly TSESTree.Node[] = parent.body;
    for (const statement of body.slice(0, Math.max(body.indexOf(child), 0))) {
      if (statement.type === AST_NODE_TYPES.ExpressionStatement && isGuard(statement.expression, context)) {
        return true;
      }
    }
  }
  return false;
}

/** True when a containment test decides whether `sink` runs (see the top of this module). */
export function isContainedBefore(sink: TSESTree.Node, context: PathContainmentContext): boolean {
  return (
    isGuardedBefore(sink, containmentGuard(context), context.sourceCode) || isAssertedBefore(sink, context)
  );
}
