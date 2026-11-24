import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/*
 * Exact value flow through local bindings, shared by the injection and URL
 * rules. A value keeps its meaning when it moves through code like this:
 *
 *   forward(url)                      a local function that returns its parameter
 *   const holder = { value: url };    holder.value
 *   const items = [url];              items[0]
 *   const { value: v } = { value: url };
 *   [url].forEach((v) => sink(v))     a callback that receives one element
 *   Promise.resolve(url).then((v) => sink(v))
 *   await Promise.resolve(url)
 *   url as string, url!
 *   let v; v = url;                   a binding written once
 *   const v = url;
 *
 * `flowSteps` lists the expressions a value is equal to, the value first. A
 * rule asks its own question (is it proven safe? does it carry the request?)
 * of each step: a proof found on any step holds for the value, so following a
 * step never loses one the rule found before. Only exact moves are followed:
 * a container written anywhere (`holder.value = x`, `items.push(x)`, handing it
 * to a function), a binding written more than once, a default value, a rest
 * element or a spread that may hide the key ends the walk, and the rule keeps
 * what it decided from the steps before.
 *
 * A step that crosses into a callback (`[x].forEach((v) => ...)`, a `.then`,
 * a write inside a nested function) also moves the sink: a check outside the
 * callback stops at its boundary, so a proof for the value must hold where the
 * value was taken (`x` in `[x]`), not inside the callback.
 *
 * Also here, for the same rewrites: argument spreads of array literals
 * (`fetch(...[url])`), strings built with `'...'.concat(...)` or
 * `[...].join('')`, imports bound to another name (`import { exec as run }`,
 * `const http2 = require('node:https')`), and request or response objects
 * recognised by their place in a handler rather than by their name.
 */

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

/** How many moves a value is followed through. */
export const MAX_FLOW_DEPTH = 8;

export interface FlowStep {
  /** An expression the value is equal to. */
  readonly node: TSESTree.Node;
  /** Where a proof for `node` must hold: the sink, or where a callback took the value. */
  readonly sink: TSESTree.Node;
}

/** Array methods that call their callback with each element as its first argument. */
const ELEMENT_CALLBACKS: ReadonlySet<string> = new Set([
  'forEach',
  'map',
  'flatMap',
  'filter',
  'find',
  'findLast',
  'findIndex',
  'findLastIndex',
  'some',
  'every',
]);

function isTypeWrapper(
  node: TSESTree.Node,
): node is
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion
  | TSESTree.TSInstantiationExpression {
  return (
    node.type === AST_NODE_TYPES.TSAsExpression ||
    node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSTypeAssertion ||
    node.type === AST_NODE_TYPES.TSInstantiationExpression
  );
}

/** Peels TypeScript wrappers, which do not change the value. */
export function peelTypeWrappers(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (isTypeWrapper(current)) {
    current = current.expression;
  }
  return current;
}

function variableOf(node: TSESTree.Identifier, sourceCode: SourceCode): Variable | null {
  return ASTUtils.findVariable(sourceCode.getScope(node), node);
}

/** True when `node` names the global `name`, not a local binding that shadows it. */
function isGlobal(node: TSESTree.Node, name: string, sourceCode: SourceCode): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier || node.name !== name) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  return variable === null || variable.defs.length === 0;
}

/** The name of a member's property: `a.b`, `a['b']`, `a[0]`; null when computed at run time. */
function memberKey(member: TSESTree.MemberExpression): string | null {
  if (!member.computed) {
    return member.property.type === AST_NODE_TYPES.Identifier ? member.property.name : null;
  }
  const property = member.property;
  return property.type === AST_NODE_TYPES.Literal &&
    (typeof property.value === 'string' || typeof property.value === 'number')
    ? String(property.value)
    : null;
}

/** The key of an object literal property, or null when it is computed at run time. */
function propertyKey(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  return property.key.type === AST_NODE_TYPES.Literal &&
    (typeof property.key.value === 'string' || typeof property.key.value === 'number')
    ? String(property.key.value)
    : null;
}

/** True when the function reads `arguments`, which aliases its parameters in sloppy code. */
function readsArguments(fn: TSESTree.Node, sourceCode: SourceCode): boolean {
  const scope = sourceCode.scopeManager?.acquire(fn);
  const args = scope?.set.get('arguments');
  return args !== undefined && args.references.length > 0;
}

/** True when nothing assigns the variable after its declaration. */
function neverReassigned(variable: Variable): boolean {
  return variable.references.every((reference) => !reference.isWrite() || reference.init === true);
}

/**
 * The single `const` declaration of a variable, or null: one definition, a
 * `const`, never written again.
 */
function constDeclarator(variable: Variable): TSESTree.VariableDeclarator | null {
  const def = variable.defs[0];
  if (
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.init === null ||
    !neverReassigned(variable)
  ) {
    return null;
  }
  return def.node;
}

/**
 * True when every use of a container binding only reads a fixed key of it
 * (`holder.value`, `items[0]`) or copies it into an object (`{ ...holder }`):
 * no write through a member, no method call (`items.push(x)`), and it is
 * never handed anywhere else, where it could be changed.
 */
function onlyReadByKey(variable: Variable): boolean {
  return variable.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    const member = reference.identifier.parent;
    // `{ ...holder }` copies the properties and changes nothing.
    if (member?.type === AST_NODE_TYPES.SpreadElement && member.parent.type === AST_NODE_TYPES.ObjectExpression) {
      return true;
    }
    if (
      member?.type !== AST_NODE_TYPES.MemberExpression ||
      member.object !== reference.identifier ||
      memberKey(member) === null
    ) {
      return false;
    }
    const use = member.parent;
    return !(
      (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === member) ||
      (use.type === AST_NODE_TYPES.UpdateExpression && use.argument === member) ||
      (use.type === AST_NODE_TYPES.UnaryExpression && use.operator === 'delete') ||
      (use.type === AST_NODE_TYPES.CallExpression && use.callee === member) ||
      (use.type === AST_NODE_TYPES.ChainExpression &&
        use.parent.type === AST_NODE_TYPES.CallExpression &&
        use.parent.callee === use) ||
      use.type === AST_NODE_TYPES.ArrayPattern ||
      use.type === AST_NODE_TYPES.ObjectPattern ||
      use.type === AST_NODE_TYPES.ForInStatement ||
      use.type === AST_NODE_TYPES.ForOfStatement
    );
  });
}

/**
 * The object or array literal a container expression holds: the literal
 * itself, or a `const` bound to one whose every use reads a fixed key.
 */
function containerLiteral(
  node: TSESTree.Node,
  sourceCode: SourceCode,
): TSESTree.ObjectExpression | TSESTree.ArrayExpression | null {
  const inner = peelTypeWrappers(node);
  if (inner.type === AST_NODE_TYPES.ObjectExpression || inner.type === AST_NODE_TYPES.ArrayExpression) {
    return inner;
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = variableOf(inner, sourceCode);
  const declarator = variable === null ? null : constDeclarator(variable);
  if (variable === null || declarator?.id.type !== AST_NODE_TYPES.Identifier || !onlyReadByKey(variable)) {
    return null;
  }
  const init = peelTypeWrappers(declarator.init as TSESTree.Node);
  return init.type === AST_NODE_TYPES.ObjectExpression || init.type === AST_NODE_TYPES.ArrayExpression
    ? init
    : null;
}

/**
 * The object literal an expression holds, through exact moves: the literal
 * itself, a `const` bound to one that is only read, a helper's argument, an
 * object property. Null when there is none.
 */
export function objectLiteralOf(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.ObjectExpression | null {
  for (const step of flowSteps(node, node, sourceCode)) {
    const literal = containerLiteral(step.node, sourceCode);
    if (literal !== null) {
      return literal.type === AST_NODE_TYPES.ObjectExpression ? literal : null;
    }
  }
  return null;
}

/**
 * The value a literal holds under `key`: the last plain property of that name
 * in an object (null when a spread after it, a getter or a computed key may
 * set it instead), or the element at that index of an array with no spread or
 * hole before it.
 */
function literalEntry(
  literal: TSESTree.ObjectExpression | TSESTree.ArrayExpression,
  key: string,
): TSESTree.Node | null {
  if (literal.type === AST_NODE_TYPES.ArrayExpression) {
    if (!/^(0|[1-9]\d*)$/u.test(key)) {
      return null;
    }
    const index = Number(key);
    const before = literal.elements.slice(0, index + 1);
    if (before.length <= index || before.some((element) => element === null || element.type === AST_NODE_TYPES.SpreadElement)) {
      return null;
    }
    return literal.elements[index] ?? null;
  }
  for (let i = literal.properties.length - 1; i >= 0; i -= 1) {
    const property = literal.properties[i];
    if (property === undefined || property.type === AST_NODE_TYPES.SpreadElement) {
      return null;
    }
    const name = propertyKey(property);
    if (name === null) {
      return null;
    }
    if (name === key) {
      return property.kind === 'init' && !property.method && property.value.type !== AST_NODE_TYPES.AssignmentPattern
        ? property.value
        : null;
    }
  }
  return null;
}

/**
 * The local function a callee names: a function declaration never
 * reassigned, or a `const` bound to a function expression or an arrow.
 */
function localFunction(
  callee: TSESTree.Node,
  sourceCode: SourceCode,
): TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression | null {
  const inner = peelTypeWrappers(callee);
  if (inner.type === AST_NODE_TYPES.FunctionExpression || inner.type === AST_NODE_TYPES.ArrowFunctionExpression) {
    return inner;
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = variableOf(inner, sourceCode);
  const def = variable?.defs[0];
  if (variable === null || variable.defs.length !== 1 || def === undefined || !neverReassigned(variable)) {
    return null;
  }
  if (def.type === 'FunctionName' && def.node.type === AST_NODE_TYPES.FunctionDeclaration) {
    return def.node;
  }
  const declarator = constDeclarator(variable);
  const init = declarator === null ? null : peelTypeWrappers(declarator.init as TSESTree.Node);
  return init?.type === AST_NODE_TYPES.FunctionExpression || init?.type === AST_NODE_TYPES.ArrowFunctionExpression
    ? init
    : null;
}

/**
 * The index of the parameter a function returns unchanged
 * (`function forward(value) { return value; }`, `(v) => v`), or -1. The
 * parameter must be a plain name never written in the body.
 */
function identityParameter(
  fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  sourceCode: SourceCode,
): number {
  if (fn.async || fn.generator || readsArguments(fn, sourceCode)) {
    return -1;
  }
  let returned: TSESTree.Node | null = null;
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    returned = fn.body;
  } else if (fn.body.body.length === 1) {
    const only = fn.body.body[0];
    returned = only?.type === AST_NODE_TYPES.ReturnStatement ? only.argument : null;
  }
  const value = returned === null ? null : peelTypeWrappers(returned);
  if (value?.type !== AST_NODE_TYPES.Identifier) {
    return -1;
  }
  const index = fn.params.findIndex(
    (param) => param.type === AST_NODE_TYPES.Identifier && param.name === value.name,
  );
  if (index === -1) {
    return -1;
  }
  const variable = sourceCode.getDeclaredVariables(fn).find((candidate) => candidate.name === value.name);
  return variable !== undefined && neverReassigned(variable) && variableOf(value, sourceCode) === variable
    ? index
    : -1;
}

/**
 * A call's arguments with each spread of an array literal laid out in place
 * (`f(...[a, b], c)` reads `a, b, c`), also through a `const` bound to one
 * that is only read by index. Null when a spread cannot be laid out: the
 * positions of the arguments after it are unknown.
 */
export function spreadArguments(
  args: readonly TSESTree.CallExpressionArgument[],
  sourceCode: SourceCode,
): TSESTree.Expression[] | null {
  const out: TSESTree.Expression[] = [];
  for (const arg of args) {
    if (arg.type !== AST_NODE_TYPES.SpreadElement) {
      out.push(arg);
      continue;
    }
    const literal = containerLiteral(arg.argument, sourceCode);
    if (literal?.type !== AST_NODE_TYPES.ArrayExpression) {
      return null;
    }
    for (const element of literal.elements) {
      if (element === null || element.type === AST_NODE_TYPES.SpreadElement) {
        return null;
      }
      out.push(element);
    }
  }
  return out;
}

/** The arguments as laid out by {@link spreadArguments}, or as written when a spread cannot be. */
export function callArguments(
  args: readonly TSESTree.CallExpressionArgument[],
  sourceCode: SourceCode,
): readonly TSESTree.CallExpressionArgument[] {
  return spreadArguments(args, sourceCode) ?? args;
}

/**
 * The call as a reader of its arguments sees it after {@link spreadArguments}:
 * the same node when nothing is laid out, else a copy whose `arguments` are
 * laid out. Hand the copy only to code that reads `arguments` and nothing
 * else; report and look up scopes on the original call.
 */
export function withArguments(node: TSESTree.CallExpression, sourceCode: SourceCode): TSESTree.CallExpression {
  const args = spreadArguments(node.arguments, sourceCode);
  return args === null || args.every((arg, index) => arg === node.arguments[index]) && args.length === node.arguments.length
    ? node
    : { ...node, arguments: args };
}

/** `Promise.resolve(x)` on the global `Promise`: its one argument, else null. */
function promiseResolveArgument(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node | null {
  const call = peelTypeWrappers(node);
  if (
    call.type !== AST_NODE_TYPES.CallExpression ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    memberKey(call.callee) !== 'resolve' ||
    !isGlobal(call.callee.object, 'Promise', sourceCode) ||
    call.arguments.length !== 1 ||
    call.arguments[0]?.type === AST_NODE_TYPES.SpreadElement
  ) {
    return null;
  }
  return call.arguments[0] ?? null;
}

/**
 * The path from a destructuring pattern down to the bound name, as keys
 * (`{ a: [, b] }` gives `a`, `1`), or null when a default value or a rest
 * element sits on the way.
 */
function patternPath(pattern: TSESTree.Node, name: TSESTree.Identifier): string[] | null {
  const path: string[] = [];
  let current: TSESTree.Node = name;
  while (current !== pattern) {
    const parent: TSESTree.Node | undefined = current.parent;
    if (parent === undefined) {
      return null;
    }
    if (parent.type === AST_NODE_TYPES.Property && parent.value === current) {
      const key = propertyKey(parent);
      if (key === null) {
        return null;
      }
      path.push(key);
      current = parent.parent;
      if (current.type !== AST_NODE_TYPES.ObjectPattern) {
        return null;
      }
      continue;
    }
    if (parent.type === AST_NODE_TYPES.ArrayPattern) {
      const index = parent.elements.indexOf(current as TSESTree.DestructuringPattern);
      if (index === -1 || parent.elements.slice(0, index).some((element) => element?.type === AST_NODE_TYPES.RestElement)) {
        return null;
      }
      path.push(String(index));
      current = parent;
      continue;
    }
    return null;
  }
  return path.reverse();
}

/** The value `const { a: { b } } = { a: { b: x } }` binds to `b`: `x`, else null. */
function destructuredValue(variable: Variable, sourceCode: SourceCode): TSESTree.Node | null {
  const declarator = constDeclarator(variable);
  const name = variable.defs[0]?.name;
  if (declarator === null || declarator.id.type === AST_NODE_TYPES.Identifier || name?.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const path = patternPath(declarator.id, name);
  if (path === null) {
    return null;
  }
  let current: TSESTree.Node = declarator.init as TSESTree.Node;
  for (const key of path) {
    const literal = containerLiteral(current, sourceCode);
    const entry = literal === null ? null : literalEntry(literal, key);
    if (entry === null) {
      return null;
    }
    current = entry;
  }
  return current;
}

/**
 * True for a callback that runs where it is passed, on values known there:
 * one handed to an array method on an array literal (`[x].forEach(cb)`) or to
 * `.then` on `Promise.resolve(x)`. A check before that call holds inside it
 * for any binding that is never written after its declaration.
 */
export function isImmediateCallback(fn: TSESTree.Node, sourceCode: SourceCode): boolean {
  if (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression && fn.type !== AST_NODE_TYPES.FunctionExpression) {
    return false;
  }
  const call = fn.parent;
  if (
    call.type !== AST_NODE_TYPES.CallExpression ||
    call.arguments[0] !== fn ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    call.callee.optional
  ) {
    return false;
  }
  const method = memberKey(call.callee);
  if (method === 'then') {
    return promiseResolveArgument(call.callee.object, sourceCode) !== null;
  }
  return (
    method !== null &&
    ELEMENT_CALLBACKS.has(method) &&
    peelTypeWrappers(call.callee.object).type === AST_NODE_TYPES.ArrayExpression
  );
}

/**
 * For the first parameter of a callback that receives one known value, that
 * value: `x` for `v` in `[x].forEach((v) => ...)` or
 * `Promise.resolve(x).then((v) => ...)`. Null otherwise.
 */
function callbackValue(variable: Variable, sourceCode: SourceCode): TSESTree.Node | null {
  const def = variable.defs[0];
  if (variable.defs.length !== 1 || def?.type !== 'Parameter' || !neverReassigned(variable)) {
    return null;
  }
  const fn = def.node;
  if (
    (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression && fn.type !== AST_NODE_TYPES.FunctionExpression) ||
    fn.params[0] !== def.name ||
    readsArguments(fn, sourceCode)
  ) {
    return null;
  }
  const call = fn.parent;
  if (
    call.type !== AST_NODE_TYPES.CallExpression ||
    call.arguments[0] !== fn ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression
  ) {
    return null;
  }
  const method = memberKey(call.callee);
  if (method === 'then') {
    return promiseResolveArgument(call.callee.object, sourceCode);
  }
  if (method === null || !ELEMENT_CALLBACKS.has(method)) {
    return null;
  }
  const array = peelTypeWrappers(call.callee.object);
  if (array.type !== AST_NODE_TYPES.ArrayExpression || array.elements.length !== 1) {
    return null;
  }
  const [element] = array.elements;
  return element == null || element.type === AST_NODE_TYPES.SpreadElement ? null : element;
}

/**
 * For a `let` declared without a value and assigned exactly once with a plain
 * `=` (`let body; [x].forEach((v) => { body = f(v); })`), the value written.
 * Before the write it holds `undefined`, which no sink treats as dangerous.
 */
function singleWriteValue(variable: Variable): TSESTree.Node | null {
  const def = variable.defs[0];
  if (
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'let' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    def.node.init !== null
  ) {
    return null;
  }
  const writes = variable.references.filter((reference) => reference.isWrite());
  const [write] = writes;
  const assignment = write?.identifier.parent;
  if (
    writes.length !== 1 ||
    assignment?.type !== AST_NODE_TYPES.AssignmentExpression ||
    assignment.operator !== '=' ||
    assignment.left !== write?.identifier
  ) {
    return null;
  }
  return assignment.right;
}

/** One exact move back from `node`, or null when the value is not followed further. */
export function flowStep(node: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode): FlowStep | null {
  if (isTypeWrapper(node)) {
    return { node: peelTypeWrappers(node), sink };
  }
  switch (node.type) {
    case AST_NODE_TYPES.AwaitExpression: {
      const value = promiseResolveArgument(node.argument, sourceCode);
      return value === null ? null : { node: value, sink };
    }
    case AST_NODE_TYPES.CallExpression: {
      // `Promise.resolve(x)` read through an `await` a caller already peeled.
      if (node.parent.type === AST_NODE_TYPES.AwaitExpression) {
        const awaited = promiseResolveArgument(node, sourceCode);
        if (awaited !== null) {
          return { node: awaited, sink };
        }
      }
      const fn = localFunction(node.callee, sourceCode);
      const index = fn === null ? -1 : identityParameter(fn, sourceCode);
      const args = index === -1 ? null : spreadArguments(node.arguments, sourceCode);
      const arg = args?.[index];
      return arg === undefined ? null : { node: arg, sink };
    }
    case AST_NODE_TYPES.MemberExpression: {
      const key = memberKey(node);
      const literal = key === null || node.optional ? null : containerLiteral(node.object, sourceCode);
      const entry = literal === null || key === null ? null : literalEntry(literal, key);
      return entry === null ? null : { node: entry, sink };
    }
    case AST_NODE_TYPES.Identifier: {
      const variable = variableOf(node, sourceCode);
      if (variable === null) {
        return null;
      }
      const declarator = constDeclarator(variable);
      if (declarator?.id.type === AST_NODE_TYPES.Identifier) {
        return { node: declarator.init as TSESTree.Node, sink };
      }
      const destructured = destructuredValue(variable, sourceCode);
      if (destructured !== null) {
        return { node: destructured, sink };
      }
      // A callback runs right where it is passed (see `isImmediateCallback`),
      // so checks before that call still count at the sink inside it.
      const received = callbackValue(variable, sourceCode);
      if (received !== null) {
        return { node: received, sink };
      }
      // A write may sit in a nested function: a proof must hold where it was written.
      const written = singleWriteValue(variable);
      return written === null ? null : { node: written, sink: written };
    }
    default:
      return null;
  }
}

/**
 * The value at `node` and every expression it is equal to, in order, up to
 * {@link MAX_FLOW_DEPTH} moves (see the header).
 */
export function flowSteps(node: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode): FlowStep[] {
  const steps: FlowStep[] = [{ node, sink }];
  const seen = new Set<TSESTree.Node>([node]);
  let current: FlowStep = steps[0] as FlowStep;
  for (let depth = 0; depth < MAX_FLOW_DEPTH; depth += 1) {
    const next = flowStep(current.node, current.sink, sourceCode);
    if (next === null || seen.has(next.node)) {
      break;
    }
    seen.add(next.node);
    steps.push(next);
    current = next;
  }
  return steps;
}

/**
 * True when `test` holds for the value or for any expression it is equal to,
 * each judged at its own sink.
 */
export function holdsAlongFlow(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  test: (node: TSESTree.Node, sink: TSESTree.Node) => boolean,
): boolean {
  return flowSteps(node, sink, sourceCode).some((step) => test(step.node, step.sink));
}

// ---------------------------------------------------------------------------
// Strings built by method
// ---------------------------------------------------------------------------

/** True when `node` is known to be a string: a string literal, a template or a string built by method. */
function isStringValued(node: TSESTree.Node, sourceCode: SourceCode, depth: number): boolean {
  const inner = peelTypeWrappers(node);
  if (inner.type === AST_NODE_TYPES.Literal) {
    return typeof inner.value === 'string';
  }
  if (inner.type === AST_NODE_TYPES.TemplateLiteral) {
    return true;
  }
  if (inner.type === AST_NODE_TYPES.BinaryExpression && inner.operator === '+') {
    return isStringValued(inner.left, sourceCode, depth + 1) || isStringValued(inner.right, sourceCode, depth + 1);
  }
  return depth < MAX_FLOW_DEPTH && stringPieces(inner, sourceCode, depth + 1) !== null;
}

/**
 * The pieces of a string built by a method, in order: `'a'.concat(x, 'b')`
 * gives `'a'`, `x`, `'b'`; `[x, '/', y].join('')` gives `x`, `'/'`, `y`, and
 * a literal separator comes back as text between them. Null for anything
 * else, including `concat` on a receiver that may be an array.
 */
export function stringPieces(
  node: TSESTree.Node,
  sourceCode: SourceCode,
  depth = 0,
): (string | TSESTree.Expression)[] | null {
  const call = peelTypeWrappers(node);
  if (
    call.type !== AST_NODE_TYPES.CallExpression ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    call.callee.optional
  ) {
    return null;
  }
  const method = memberKey(call.callee);
  const receiver = call.callee.object;
  if (method === 'concat' && isStringValued(receiver, sourceCode, depth)) {
    const args = spreadArguments(call.arguments, sourceCode);
    return args === null ? null : [receiver, ...args];
  }
  if (method !== 'join') {
    return null;
  }
  const list = peelTypeWrappers(receiver);
  const separator = call.arguments[0];
  if (
    list.type !== AST_NODE_TYPES.ArrayExpression ||
    call.arguments.length !== 1 ||
    separator?.type !== AST_NODE_TYPES.Literal ||
    typeof separator.value !== 'string'
  ) {
    return null;
  }
  const pieces: (string | TSESTree.Expression)[] = [];
  for (const [index, element] of list.elements.entries()) {
    if (element === null || element.type === AST_NODE_TYPES.SpreadElement) {
      return null;
    }
    if (index > 0 && separator.value !== '') {
      pieces.push(separator.value);
    }
    pieces.push(element);
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Imports bound to another name
// ---------------------------------------------------------------------------

/** How a local binding reads a module: a named export, `default`, or `*` for the whole module. */
export interface ImportedBinding {
  readonly module: string;
  readonly imported: string;
}

/** The module a `require('m')` call names, through type wrappers, else null. */
function requiredModule(node: TSESTree.Node, sourceCode: SourceCode): string | null {
  const call = peelTypeWrappers(node);
  const [first] = call.type === AST_NODE_TYPES.CallExpression ? call.arguments : [];
  return call.type === AST_NODE_TYPES.CallExpression &&
    isGlobal(call.callee, 'require', sourceCode) &&
    call.arguments.length === 1 &&
    first?.type === AST_NODE_TYPES.Literal &&
    typeof first.value === 'string'
    ? first.value
    : null;
}

/**
 * The module and export a local binding reads: `import { exec as run }`,
 * `import http from 'node:http'`, `import * as cp`, `const cp = require(...)`,
 * `const { exec: run } = require(...)` and `const run = require(...).exec`.
 * Null for anything else, or for a `require` binding that is written again.
 */
export function importedBinding(identifier: TSESTree.Identifier, sourceCode: SourceCode): ImportedBinding | null {
  const variable = variableOf(identifier, sourceCode);
  const def = variable?.defs[0];
  if (variable === null || variable.defs.length !== 1 || def === undefined) {
    return null;
  }
  if (def.type === 'ImportBinding') {
    const declaration = def.parent;
    if (declaration.type !== AST_NODE_TYPES.ImportDeclaration || declaration.importKind === 'type') {
      return null;
    }
    const module = declaration.source.value;
    const specifier = def.node;
    switch (specifier.type) {
      case AST_NODE_TYPES.ImportDefaultSpecifier:
        return { module, imported: 'default' };
      case AST_NODE_TYPES.ImportNamespaceSpecifier:
        return { module, imported: '*' };
      case AST_NODE_TYPES.ImportSpecifier:
        if (specifier.importKind === 'type') {
          return null;
        }
        return {
          module,
          imported:
            specifier.imported.type === AST_NODE_TYPES.Identifier
              ? specifier.imported.name
              : specifier.imported.value,
        };
      default:
        return null;
    }
  }
  const declarator = constDeclarator(variable);
  if (declarator === null) {
    return null;
  }
  const init = peelTypeWrappers(declarator.init as TSESTree.Node);
  if (declarator.id.type === AST_NODE_TYPES.Identifier) {
    const whole = requiredModule(init, sourceCode);
    if (whole !== null) {
      return { module: whole, imported: '*' };
    }
    if (init.type === AST_NODE_TYPES.MemberExpression) {
      const module = requiredModule(init.object, sourceCode);
      const key = memberKey(init);
      return module === null || key === null ? null : { module, imported: key };
    }
    return null;
  }
  if (declarator.id.type !== AST_NODE_TYPES.ObjectPattern) {
    return null;
  }
  const module = requiredModule(init, sourceCode);
  const path = module === null ? null : patternPath(declarator.id, def.name as TSESTree.Identifier);
  return module === null || path?.length !== 1 ? null : { module, imported: path[0] as string };
}

/**
 * The name a module's default export or namespace is usually bound to, where
 * that is not the module name itself.
 */
const CONVENTIONAL_NAMES: Readonly<Record<string, string>> = {
  dompurify: 'DOMPurify',
  'isomorphic-dompurify': 'DOMPurify',
  'sanitize-html': 'sanitizeHtml',
};

/** Modules whose default export is a function with a usual name of its own. */
const CONVENTIONAL_DEFAULTS: Readonly<Record<string, string>> = {
  'node-fetch': 'fetch',
};

/**
 * The usual local name of a module binding: `exec` for `{ exec as run }`,
 * `https` for `import * as client from 'node:https'`, `DOMPurify` for the
 * default export of `dompurify`, `fetch` for the default export of
 * `node-fetch`. Null when the module has no plain name.
 */
export function conventionalName(binding: ImportedBinding): string | null {
  if (binding.imported !== '*' && binding.imported !== 'default') {
    return binding.imported;
  }
  const module = binding.module.replace(/^node:/u, '');
  const known = (binding.imported === 'default' ? CONVENTIONAL_DEFAULTS[module] : undefined) ?? CONVENTIONAL_NAMES[module];
  if (known !== undefined) {
    return known;
  }
  return /^[A-Za-z_$][\w$]*$/u.test(module) ? module : null;
}

/**
 * The callee as it reads with every import under its usual name
 * (`run(...)` for `import { exec as run }` reads `exec`, `client.get` for
 * `const client = require('https')` reads `https.get`), whitespace dropped.
 * Null when the root of the callee is not an import bound to another name.
 */
export function conventionalCallee(callee: TSESTree.Node, sourceCode: SourceCode): string | null {
  const keys: string[] = [];
  let current = peelTypeWrappers(callee);
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    const key = memberKey(current);
    if (key === null || current.computed) {
      return null;
    }
    keys.unshift(key);
    current = peelTypeWrappers(current.object);
  }
  if (current.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const binding = importedBinding(current, sourceCode);
  const name = binding === null ? null : conventionalName(binding);
  if (name === null || name === current.name) {
    return null;
  }
  return [name, ...keys].join('.');
}

// ---------------------------------------------------------------------------
// Request and response objects by their place in a handler
// ---------------------------------------------------------------------------

export type HandlerRole = 'request' | 'response';

/** Methods that register a route or middleware handler: `app.get(path, handler)`. */
const ROUTE_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'del',
  'all',
  'use',
  'options',
  'head',
]);

/** Nest parameter decorators for the request and response objects. */
const DECORATOR_ROLES: Readonly<Record<string, HandlerRole>> = {
  Req: 'request',
  Request: 'request',
  Res: 'response',
  Response: 'response',
};

/** Type names a request or response parameter is annotated with. */
const TYPE_ROLES: Readonly<Record<string, HandlerRole>> = {
  Request: 'request',
  IncomingMessage: 'request',
  FastifyRequest: 'request',
  Response: 'response',
  ServerResponse: 'response',
  FastifyReply: 'response',
};

/** The role a Nest parameter decorator (`@Req()`, `@Res()`) gives, read through import aliases. */
function decoratorRole(param: TSESTree.Node, sourceCode: SourceCode): HandlerRole | null {
  const decorators = 'decorators' in param ? (param.decorators ?? []) : [];
  for (const decorator of decorators) {
    const call = decorator.expression;
    if (call.type !== AST_NODE_TYPES.CallExpression || call.callee.type !== AST_NODE_TYPES.Identifier) {
      continue;
    }
    const binding = importedBinding(call.callee, sourceCode);
    const name = binding === null ? call.callee.name : binding.imported;
    const role = DECORATOR_ROLES[name];
    if (role !== undefined && (binding === null || binding.module === '@nestjs/common')) {
      return role;
    }
  }
  return null;
}

/** The role a parameter's type annotation gives (`res: Response`, `reply: FastifyReply`). */
function annotationRole(param: TSESTree.Node): HandlerRole | null {
  const annotation = 'typeAnnotation' in param ? param.typeAnnotation : undefined;
  const type =
    annotation != null && annotation.type === AST_NODE_TYPES.TSTypeAnnotation
      ? annotation.typeAnnotation
      : null;
  if (type?.type !== AST_NODE_TYPES.TSTypeReference) {
    return null;
  }
  const name =
    type.typeName.type === AST_NODE_TYPES.Identifier
      ? type.typeName.name
      : type.typeName.type === AST_NODE_TYPES.TSQualifiedName
        ? type.typeName.right.name
        : null;
  return name === null ? null : (TYPE_ROLES[name] ?? null);
}

/**
 * True when a call registers `handler` as a request handler: an argument of
 * `createServer(...)` or `server.on('request', ...)`, any argument of
 * `app.use(...)`, or an argument after the route path of `app.get(path, ...)`
 * and the other route methods.
 */
function registersHandler(call: TSESTree.CallExpression, handler: TSESTree.Node): boolean {
  const callee = peelTypeWrappers(call.callee);
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'createServer';
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const method = memberKey(callee);
  if (method === 'createServer' || method === 'use') {
    return true;
  }
  const [first] = call.arguments;
  if (method === 'on') {
    return first?.type === AST_NODE_TYPES.Literal && first.value === 'request';
  }
  const routePath =
    (first?.type === AST_NODE_TYPES.Literal && typeof first.value === 'string') ||
    first?.type === AST_NODE_TYPES.TemplateLiteral;
  return method !== null && ROUTE_METHODS.has(method) && routePath && first !== handler;
}

/** True when the function is handed to a call that registers handlers, directly or by name. */
function isRegisteredHandler(
  fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  sourceCode: SourceCode,
): boolean {
  const handedTo = (node: TSESTree.Node): boolean => {
    const parent = node.parent;
    return (
      parent?.type === AST_NODE_TYPES.CallExpression &&
      parent.callee !== node &&
      parent.arguments.includes(node as TSESTree.Expression) &&
      registersHandler(parent, node)
    );
  };
  if (handedTo(fn)) {
    return true;
  }
  const name =
    fn.type === AST_NODE_TYPES.FunctionDeclaration
      ? fn.id
      : fn.parent.type === AST_NODE_TYPES.VariableDeclarator && fn.parent.init === fn
        ? fn.parent.id
        : null;
  if (name?.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = fn.type === AST_NODE_TYPES.FunctionDeclaration
    ? ASTUtils.findVariable(sourceCode.getScope(fn), name)
    : variableOf(name, sourceCode);
  return variable !== null && neverReassigned(variable) && variable.references.some((reference) => handedTo(reference.identifier));
}

/**
 * The role of the binding `identifier` names when it is a handler parameter:
 * `request` for the first parameter and `response` for the second of a
 * function registered as a route handler or server listener
 * (`app.get(path, (a, b) => ...)`, `http.createServer(handler)`), for a Nest
 * parameter decorated `@Req()` / `@Res()`, or for one annotated `Request` /
 * `Response` (and the Node and Fastify types). Null otherwise.
 */
export function handlerRole(identifier: TSESTree.Identifier, sourceCode: SourceCode): HandlerRole | null {
  const variable = variableOf(identifier, sourceCode);
  const def = variable?.defs[0];
  if (variable === null || variable.defs.length !== 1 || def?.type !== 'Parameter' || !neverReassigned(variable)) {
    return null;
  }
  const fn = def.node;
  if (
    fn.type !== AST_NODE_TYPES.FunctionDeclaration &&
    fn.type !== AST_NODE_TYPES.FunctionExpression &&
    fn.type !== AST_NODE_TYPES.ArrowFunctionExpression
  ) {
    return null;
  }
  const index = fn.params.findIndex((param) => {
    const id = param.type === AST_NODE_TYPES.TSParameterProperty ? param.parameter : param;
    return id === def.name;
  });
  if (index === -1) {
    return null;
  }
  const param = fn.params[index] as TSESTree.Parameter;
  const declared = decoratorRole(param, sourceCode) ?? annotationRole(def.name);
  if (declared !== null) {
    return declared;
  }
  if (index > 1 || !isRegisteredHandler(fn, sourceCode) || !hasResponseParameter(fn, sourceCode)) {
    return null;
  }
  return index === 0 ? 'request' : 'response';
}

/**
 * True when a handler's second parameter is a response object: present and
 * never called. Koa's `(ctx, next)` calls `next()`, and its `ctx` is a context
 * object, not a request.
 */
function hasResponseParameter(
  fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  sourceCode: SourceCode,
): boolean {
  const second = fn.params[1];
  if (second?.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = sourceCode.getDeclaredVariables(fn).find((candidate) => candidate.name === second.name);
  return (
    variable !== undefined &&
    variable.references.every((reference) => {
      const parent = reference.identifier.parent;
      return !(parent?.type === AST_NODE_TYPES.CallExpression && parent.callee === reference.identifier);
    })
  );
}
