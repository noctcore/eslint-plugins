import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import {
  type GuardContext,
  isAllowlistedMember,
  isDotSegmentRefused,
  isLiteralTableRead,
  isProvenSafeValue,
} from './guards';
import { flowStep, handlerRole } from './value-flow';

/*
 * In-function data flow from request-shaped input to a sink, without type
 * information. A value carries the request when it is, or is built from, a
 * member of a request object (`req.query.file`, `req.body?.name`):
 *
 *  - through `const` and `let` bindings (every write is followed), destructuring
 *    and `for...of` over a carrying value;
 *  - through string building (`+`, templates), `?:`, `||` / `??`;
 *  - through member access (`parts[0]`, `JSON.parse(x).value`) and object or
 *    array literals holding it, getters included;
 *  - through calls: a call with a carrying argument, receiver or callee carries
 *    it (`trim(x)`, `x.split(',')`, `readInput()` when `readInput` was built
 *    from it), unless the callee is a known sanitizer for the sink;
 *  - through `arr.push(x)` into `arr`.
 *
 * A bare request object (`const { query } = req`) carries it too, and so does
 * a field destructured from the first parameter of a function under a request
 * field name (`({ query }) => ...`, `({ params: { file } }) => ...`).
 *
 * At each binding the sink's guard is asked first (`../guards`): a value
 * checked against an allowlist or a safe anchored regex before the sink stops
 * the flow there.
 *
 * A proof holds only for the text that was checked. Below a call that is not
 * known to keep its arguments' text (a decoder such as `decodeURIComponent`,
 * a string method such as `replace` or `slice`, `path.parse(x).name`,
 * `basename(x, ext)`, `new URL(x)`, a helper), and below a member read of a
 * checked value, regex and schema proofs, sanitizers and dot checks no longer
 * cut the flow: `%2e%2e` passes a check for `..` and decodes to it, and
 * `'...'` passes a dot check while `path.parse('...').name` is `..`.
 */

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

const MAX_DEPTH = 24;

/** Calls whose result carries none of the input's characters that matter. */
const NUMERIC_CALLS: ReadonlySet<string> = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean']);
/** Properties whose value is not the input's text. */
const NON_TEXT_PROPERTIES: ReadonlySet<string> = new Set(['length', 'size']);
/** Methods that put a value into the array they are called on. */
const ARRAY_WRITERS: ReadonlySet<string> = new Set(['push', 'unshift', 'splice', 'fill']);
/** Global functions that decode text into characters a check on the input never saw. */
const DECODERS: ReadonlySet<string> = new Set(['decodeURIComponent', 'decodeURI', 'unescape', 'atob']);
/**
 * Methods whose result keeps a checked value checked: case changes, a string
 * conversion and joining checked parts. Any other method on a checked value
 * (`replace`, `slice`, `trim`, `normalize`, `split`) can make `..` or a
 * separator out of text that had none.
 */
const PRESERVING_METHODS: ReadonlySet<string> = new Set([
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toString',
  'valueOf',
  'join',
  'concat',
]);
/** Fields of a request object that hold the requester's input. */
const REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'query',
  'params',
  'body',
  'headers',
  'cookies',
  'files',
  'file',
  'request',
]);

export interface TaintOptions {
  /** Root identifiers of request-shaped input (`req`, `request`, `ctx`). */
  readonly requestObjects: ReadonlySet<string>;
  /** Where the value is used: decides which guards and sanitizers count. */
  readonly context: GuardContext;
  /** Callee source texts whose result is safe for the sink (`path.extname`). */
  readonly sanitizers: ReadonlySet<string>;
  /**
   * Callee source texts whose result is one path segment with no separator,
   * which may still be `.` or `..` (`path.basename`): it is safe only when the
   * binding that holds it is refused as `..` before the sink.
   */
  readonly segmentSanitizers?: ReadonlySet<string>;
  /**
   * Callee source texts whose result keeps each argument's text (`path.join`,
   * `path.resolve`, `path.normalize`), so a proof on an argument carries over.
   * Any other call reshapes the value and its arguments' proofs no longer hold.
   */
  readonly preservingCalls?: ReadonlySet<string>;
  /** Bindings that are themselves the input followed (a helper's parameter). */
  readonly sourceVariables?: ReadonlySet<Variable>;
  /**
   * Also take a handler's request parameter as request-shaped input, whatever
   * its name: the first parameter of a route handler, a Nest `@Req()` (see
   * `handlerRole` in `./value-flow`).
   */
  readonly handlerRequests?: boolean;
}

interface Walk {
  readonly options: TaintOptions;
  readonly sink: TSESTree.Node;
  readonly sourceCode: SourceCode;
  readonly seen: Set<Variable>;
  /** True below a decoder or a reshaping method: proofs on the text no longer hold. */
  readonly reshaped: boolean;
}

/**
 * The request member a value carries at `sink` (`req.query.file`), or null
 * when none reaches it.
 */
export function requestSourceOf(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  options: TaintOptions,
  sourceCode: SourceCode,
): TSESTree.Node | null {
  return carried(node, { options, sink, sourceCode, seen: new Set(), reshaped: false }, 0);
}

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current: TSESTree.Node = node;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
    } else if (
      current.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.type === AST_NODE_TYPES.TSAsExpression ||
      current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.type === AST_NODE_TYPES.TSTypeAssertion
    ) {
      current = current.expression;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

/** True when `node` names a request object: by name, or by its place in a handler. */
function isRequestObject(node: TSESTree.Identifier, walk: Walk): boolean {
  return (
    walk.options.requestObjects.has(node.name) ||
    (walk.options.handlerRequests === true && handlerRole(node, walk.sourceCode) === 'request')
  );
}

function isRequestMember(node: TSESTree.Node, walk: Walk): boolean {
  const inner = node.type === AST_NODE_TYPES.ChainExpression ? node.expression : node;
  if (inner.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const root = rootIdentifier(inner);
  return root !== null && isRequestObject(root, walk);
}

function carried(raw: TSESTree.Node, walk: Walk, depth: number): TSESTree.Node | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  const next = (child: TSESTree.Node | null | undefined): TSESTree.Node | null =>
    child == null ? null : carried(child, walk, depth + 1);
  const firstOf = (children: readonly (TSESTree.Node | null)[]): TSESTree.Node | null => {
    for (const child of children) {
      const found = next(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  if (isRequestMember(raw, walk)) {
    // `if (!NAMES.includes(req.params.name)) return` leaves an author's literal.
    return isAllowlistedMember(raw, walk.sink, walk.sourceCode) ? null : raw;
  }
  // A value proven harmless (a confined schema's output, a literal table read)
  // cuts the flow wherever it sits, not only behind a binding. A literal
  // table read stays an author's literal even when decoded.
  if (
    raw.type !== AST_NODE_TYPES.Identifier &&
    (isLiteralTableRead(raw, walk.sourceCode) ||
      (!walk.reshaped &&
        isProvenSafeValue(raw, walk.sink, walk.options.context, walk.sourceCode)))
  ) {
    return null;
  }
  const node = raw;
  // An exact move keeps the text: `forward(x)`, `holder.value`, `items[0]`
  // and `await Promise.resolve(x)` are `x`, so its proofs still hold.
  // A configured sanitizer keeps its meaning even when this file defines it.
  if (
    (node.type === AST_NODE_TYPES.CallExpression &&
      !walk.options.sanitizers.has(squash(walk.sourceCode.getText(peelTypes(node.callee))))) ||
    node.type === AST_NODE_TYPES.MemberExpression ||
    node.type === AST_NODE_TYPES.AwaitExpression
  ) {
    const step = flowStep(node, walk.sink, walk.sourceCode);
    if (step !== null) {
      return next(step.node);
    }
  }
  switch (node.type) {
    case AST_NODE_TYPES.Identifier:
      return carriedByVariable(node, walk, depth);
    case AST_NODE_TYPES.ChainExpression:
      return next(node.expression);
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSTypeAssertion:
      return next(node.expression);
    case AST_NODE_TYPES.AwaitExpression:
      return next(node.argument);
    case AST_NODE_TYPES.TemplateLiteral:
      return firstOf(node.expressions);
    case AST_NODE_TYPES.TaggedTemplateExpression:
      return firstOf(node.quasi.expressions);
    case AST_NODE_TYPES.BinaryExpression:
      // Only `+` builds a string; comparisons and arithmetic yield booleans and numbers.
      return node.operator === '+' ? firstOf([node.left, node.right]) : null;
    case AST_NODE_TYPES.LogicalExpression:
      return firstOf([node.left, node.right]);
    case AST_NODE_TYPES.ConditionalExpression:
      return firstOf([node.consequent, node.alternate]);
    case AST_NODE_TYPES.SequenceExpression:
      return next(node.expressions.at(-1));
    case AST_NODE_TYPES.AssignmentExpression:
      return next(node.right);
    case AST_NODE_TYPES.MemberExpression:
      if (
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        NON_TEXT_PROPERTIES.has(node.property.name)
      ) {
        return null;
      }
      // A part of a checked value is not the checked text (`n[0]`, `parse(n).name`).
      return carried(node.object, walk.reshaped ? walk : { ...walk, reshaped: true }, depth + 1);
    case AST_NODE_TYPES.ArrayExpression:
      return firstOf(node.elements.map((element) => element ?? null));
    case AST_NODE_TYPES.SpreadElement:
      return next(node.argument);
    case AST_NODE_TYPES.ObjectExpression:
      return firstOf(node.properties.map((property) => property));
    case AST_NODE_TYPES.Property:
      if (
        node.value.type === AST_NODE_TYPES.FunctionExpression ||
        node.value.type === AST_NODE_TYPES.ArrowFunctionExpression
      ) {
        return carriedByReturn(node.value, walk, depth);
      }
      return next(node.value);
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.FunctionExpression:
      return carriedByReturn(node, walk, depth);
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return carriedByCall(node, walk, depth);
    default:
      return null;
  }
}

/** A function value carries the request when it returns a carrying value (a closure over it). */
function carriedByReturn(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
  walk: Walk,
  depth: number,
): TSESTree.Node | null {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return carried(fn.body, walk, depth + 1);
  }
  for (const statement of fn.body.body) {
    if (statement.type === AST_NODE_TYPES.ReturnStatement && statement.argument !== null) {
      const found = carried(statement.argument, walk, depth + 1);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/** Peels type wrappers, which do not change the value. */
function peelTypes(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * True for a call that decodes its argument into new characters:
 * `decodeURIComponent(x)`, `querystring.unescape(x)`, `String.fromCharCode(...)`,
 * or `Buffer.from(x, enc)` with an encoding other than utf8 (base64, hex).
 */
function isDecoder(node: TSESTree.CallExpression | TSESTree.NewExpression): boolean {
  const callee = peelTypes(node.callee);
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return DECODERS.has(callee.name);
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const method = callee.property.name;
  const owner = callee.object.type === AST_NODE_TYPES.Identifier ? callee.object.name : null;
  if (method === 'unescape' || method === 'fromCharCode' || method === 'fromCodePoint') {
    return true;
  }
  if (owner === 'Buffer' && method === 'from') {
    const encoding = node.arguments[1];
    return !(
      encoding === undefined ||
      (encoding.type === AST_NODE_TYPES.Literal &&
        typeof encoding.value === 'string' &&
        /^utf-?8$/iu.test(encoding.value))
    );
  }
  return false;
}

/** Global calls that keep their argument's text: a string conversion and URI encoding. */
const TEXT_KEEPING_GLOBALS: ReadonlySet<string> = new Set(['String', 'encodeURIComponent', 'encodeURI']);

/**
 * True when a call's result keeps each argument's text, so a proof on an
 * argument still holds for it: a call in `preservingCalls` (`path.join`),
 * a segment sanitizer with one argument (`basename(x)`, not `basename(x, ext)`),
 * `String(x)` and URI encoding, or a method that keeps its receiver checked
 * (`parts.join(sep)`, `a.concat(b)`). Every other call, `path.parse`,
 * `_.trim`, `new URL` and local helpers included, may change the text.
 */
function keepsArgumentText(
  node: TSESTree.CallExpression | TSESTree.NewExpression,
  callee: TSESTree.Node,
  calleeText: string,
  walk: Walk,
): boolean {
  if (node.type === AST_NODE_TYPES.NewExpression) {
    return false;
  }
  if (walk.options.preservingCalls?.has(calleeText) === true) {
    return true;
  }
  if (walk.options.segmentSanitizers?.has(calleeText) === true) {
    return node.arguments.length === 1;
  }
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return TEXT_KEEPING_GLOBALS.has(callee.name);
  }
  return callee.type === AST_NODE_TYPES.MemberExpression && !reshapesReceiver(callee);
}

/**
 * True for a method call on a value that can reshape its text (`x.replace(...)`,
 * `x.slice(1)`, `x.normalize('NFKC')`), as opposed to one that keeps it checked.
 */
function reshapesReceiver(callee: TSESTree.MemberExpression): boolean {
  return (
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    !PRESERVING_METHODS.has(callee.property.name)
  );
}

function carriedByCall(
  node: TSESTree.CallExpression | TSESTree.NewExpression,
  walk: Walk,
  depth: number,
): TSESTree.Node | null {
  const callee = peelTypes(node.callee);
  const calleeText = squash(walk.sourceCode.getText(callee));
  if (!walk.reshaped && walk.options.sanitizers.has(calleeText)) {
    return null;
  }
  if (callee.type === AST_NODE_TYPES.Identifier && NUMERIC_CALLS.has(callee.name)) {
    return null;
  }
  // Only a call known to keep its arguments' text keeps their proofs:
  // `basename('...', extname('...'))` and `path.parse('...').name` are `..`.
  const argumentWalk =
    !walk.reshaped && (isDecoder(node) || !keepsArgumentText(node, callee, calleeText, walk))
      ? { ...walk, reshaped: true }
      : walk;
  for (const arg of node.arguments) {
    const found = carried(arg, argumentWalk, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  if (callee.type === AST_NODE_TYPES.MemberExpression) {
    const receiverWalk =
      !walk.reshaped && reshapesReceiver(callee) ? { ...walk, reshaped: true } : walk;
    return carried(callee.object, receiverWalk, depth + 1);
  }
  if (callee.type === AST_NODE_TYPES.Identifier) {
    const variable = ASTUtils.findVariable(walk.sourceCode.getScope(callee), callee);
    const def = variable?.defs[0];
    // A local function value built from the request: `const read = capture(input); read()`.
    if (def?.type === 'Variable') {
      return carried(callee, walk, depth + 1);
    }
  }
  return null;
}

function carriedByVariable(
  node: TSESTree.Identifier,
  walk: Walk,
  depth: number,
): TSESTree.Node | null {
  if (isRequestObject(node, walk)) {
    // The request object itself, reached through `const { query } = req`.
    return node;
  }
  const variable = ASTUtils.findVariable(walk.sourceCode.getScope(node), node);
  if (variable === null || walk.seen.has(variable)) {
    return null;
  }
  if (
    !walk.reshaped &&
    isProvenSafeValue(node, walk.sink, walk.options.context, walk.sourceCode)
  ) {
    return null;
  }
  if (walk.options.sourceVariables?.has(variable) === true || isRequestFieldParameter(variable)) {
    return node;
  }
  // A callback's parameter holds the value it was handed: `v` in `[x].forEach((v) => ...)`.
  if (variable.defs[0]?.type === 'Parameter') {
    const step = flowStep(node, walk.sink, walk.sourceCode);
    if (step !== null) {
      walk.seen.add(variable);
      try {
        return carried(step.node, walk, depth + 1);
      } finally {
        walk.seen.delete(variable);
      }
    }
  }
  // `const name = basename(x)` refused as `..` before the sink is one segment
  // that stays in its directory.
  const segmentChecked =
    !walk.reshaped &&
    (walk.options.segmentSanitizers?.size ?? 0) > 0 &&
    isDotSegmentRefused(node, walk.sink, walk.sourceCode);
  walk.seen.add(variable);
  try {
    for (const reference of variable.references) {
      if (reference.isWrite() && reference.writeExpr != null) {
        if (segmentChecked && isSegmentSanitizerCall(reference.writeExpr, walk)) {
          continue;
        }
        const found = carried(reference.writeExpr, walk, depth + 1);
        if (found !== null) {
          return found;
        }
        continue;
      }
      // `arr.push(x)`, `arr[i] = x`: a write into the array the binding holds.
      const parent = reference.identifier.parent;
      if (
        parent?.type !== AST_NODE_TYPES.MemberExpression ||
        parent.object !== reference.identifier
      ) {
        continue;
      }
      const grand = parent.parent;
      if (
        grand?.type === AST_NODE_TYPES.CallExpression &&
        grand.callee === parent &&
        !parent.computed &&
        parent.property.type === AST_NODE_TYPES.Identifier &&
        ARRAY_WRITERS.has(parent.property.name)
      ) {
        for (const arg of grand.arguments) {
          const found = carried(arg, walk, depth + 1);
          if (found !== null) {
            return found;
          }
        }
      } else if (grand?.type === AST_NODE_TYPES.AssignmentExpression && grand.left === parent) {
        const found = carried(grand.right, walk, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  } finally {
    walk.seen.delete(variable);
  }
}

/**
 * True for a call to a segment sanitizer (`basename(x)`), read through type
 * wrappers, `await` and case changes (`basename(x).toLowerCase()`).
 */
function isSegmentSanitizerCall(node: TSESTree.Node, walk: Walk): boolean {
  let current = peelTypes(node);
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current.type === AST_NODE_TYPES.AwaitExpression) {
      current = peelTypes(current.argument);
      continue;
    }
    if (current.type !== AST_NODE_TYPES.CallExpression) {
      return false;
    }
    const callee = peelTypes(current.callee);
    if (walk.options.segmentSanitizers?.has(squash(walk.sourceCode.getText(callee))) === true) {
      return true;
    }
    if (
      callee.type !== AST_NODE_TYPES.MemberExpression ||
      callee.computed ||
      callee.property.type !== AST_NODE_TYPES.Identifier ||
      !CASE_METHODS.has(callee.property.name)
    ) {
      return false;
    }
    current = peelTypes(callee.object);
  }
  return false;
}

const CASE_METHODS: ReadonlySet<string> = new Set([
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
]);

/**
 * True for a binding destructured from the first parameter of a function under
 * a request field name: `query` in `({ query }) => ...`, `file` in
 * `({ params: { file } }) => ...`, `q` in `({ query: q }) => ...`.
 */
function isRequestFieldParameter(variable: Variable): boolean {
  const def = variable.defs[0];
  if (def?.type !== 'Parameter') {
    return false;
  }
  const fn = def.node;
  if (
    fn.type !== AST_NODE_TYPES.FunctionDeclaration &&
    fn.type !== AST_NODE_TYPES.FunctionExpression &&
    fn.type !== AST_NODE_TYPES.ArrowFunctionExpression
  ) {
    return false;
  }
  const first = fn.params[0];
  // Climb from the bound name to the first parameter, noting the outermost key.
  let current: TSESTree.Node = def.name;
  let field: string | null = null;
  for (let depth = 0; depth < MAX_DEPTH && current !== first; depth += 1) {
    const parent: TSESTree.Node | undefined = current.parent;
    if (parent === undefined) {
      return false;
    }
    if (parent.type === AST_NODE_TYPES.Property && parent.value === current) {
      field =
        !parent.computed && parent.key.type === AST_NODE_TYPES.Identifier
          ? parent.key.name
          : parent.key.type === AST_NODE_TYPES.Literal && typeof parent.key.value === 'string'
            ? parent.key.value
            : null;
    } else if (
      parent.type !== AST_NODE_TYPES.ObjectPattern &&
      parent.type !== AST_NODE_TYPES.AssignmentPattern &&
      parent.type !== AST_NODE_TYPES.ArrayPattern
    ) {
      return false;
    }
    current = parent;
  }
  return current === first && first.type !== AST_NODE_TYPES.Identifier && field !== null && REQUEST_FIELDS.has(field);
}
