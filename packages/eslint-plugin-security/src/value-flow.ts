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
 * of each step.
 *
 * There are two modes. A `'proof'` walk (the default) feeds checks that turn a
 * report into no report, so it follows a move only when it can show the value
 * is still exact, from an allow-list rather than a list of known writes:
 *
 *   - a container is a `const` object or array literal that is not exported,
 *     holds only plain data (no methods, getters, setters, function values or
 *     spreads, at any depth), and whose every reference is a fixed-key read
 *     in a read-only place (see `readOnlyUse`);
 *   - a `let` written once counts only when that write runs unconditionally
 *     before the read, earlier in the same statement list;
 *   - a callback value counts only for a callback with exactly one parameter;
 *   - a move that lands on a binding written again after its declaration
 *     (`const box = [u]; u = other`) moves the sink to where the value was
 *     taken, so a check on `u` before the sink does not count for `box[0]`;
 *   - no binding or container is relied on where an `eval` can reach it.
 *
 * Anything else ends the walk, and the rule keeps what it decided before. A
 * `'taint'` walk feeds checks that turn no report into a report, and keeps the
 * looser moves: a rule only adds what it finds there to what it found before.
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

type Scope = TSESLint.Scope.Scope;

const EVAL_SCOPES = new WeakMap<Scope, boolean>();

/**
 * True when code in `scope` or a scope inside it names the global `eval`
 * (`eval('C.httpOnly = false')`, `(0, eval)(code)`): that code can write any
 * binding it sees without a reference the scope manager can show.
 */
function namesEval(scope: Scope): boolean {
  const known = EVAL_SCOPES.get(scope);
  if (known !== undefined) {
    return known;
  }
  const found =
    scope.references.some(
      (reference) =>
        reference.identifier.type === AST_NODE_TYPES.Identifier &&
        reference.identifier.name === 'eval' &&
        (reference.resolved === null || reference.resolved.defs.length === 0),
    ) || scope.childScopes.some((child) => namesEval(child));
  EVAL_SCOPES.set(scope, found);
  return found;
}

/** True when an `eval` that can see the binding may write it or what it holds (see `namesEval`). */
function evalReaches(variable: Variable): boolean {
  return namesEval(variable.scope);
}

/**
 * True when a binding may hold another value later than where it was read:
 * written after its declaration, declared twice, or in reach of an `eval`.
 */
function mayChange(variable: Variable): boolean {
  return variable.defs.length !== 1 || !neverReassigned(variable) || evalReaches(variable);
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
 * True when `node` is assigned to by a destructuring pattern it sits in:
 * `({ a: holder.x } = src)`, `[holder.x = 'd'] = src`, `[...holder.x] = src`.
 */
function isPatternTarget(node: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  for (let parent = node.parent; parent != null; child = parent, parent = parent.parent) {
    switch (parent.type) {
      case AST_NODE_TYPES.ObjectPattern:
      case AST_NODE_TYPES.ArrayPattern:
        return true;
      case AST_NODE_TYPES.Property:
        if (parent.value !== child || parent.parent.type !== AST_NODE_TYPES.ObjectPattern) {
          return false;
        }
        break;
      case AST_NODE_TYPES.AssignmentPattern:
        if (parent.left !== child) {
          return false;
        }
        break;
      case AST_NODE_TYPES.RestElement:
        break;
      default:
        return false;
    }
  }
  return false;
}

/** True when the expression is written or changed where it stands. */
function isWrittenHere(node: TSESTree.Node): boolean {
  const use = node.parent;
  if (use === undefined) {
    return false;
  }
  return (
    (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === node) ||
    (use.type === AST_NODE_TYPES.UpdateExpression && use.argument === node) ||
    (use.type === AST_NODE_TYPES.UnaryExpression && use.operator === 'delete') ||
    (use.type === AST_NODE_TYPES.CallExpression && use.callee === node) ||
    (use.type === AST_NODE_TYPES.ChainExpression &&
      use.parent.type === AST_NODE_TYPES.CallExpression &&
      use.parent.callee === use) ||
    ((use.type === AST_NODE_TYPES.ForInStatement || use.type === AST_NODE_TYPES.ForOfStatement) && use.left === node) ||
    isPatternTarget(node)
  );
}

/**
 * The value a literal holds along a path of fixed keys (`opts.secure` in
 * `{ opts: { secure: true } }`), through nested object and array literals.
 * Null when a step is not a plain entry of a literal.
 */
function entryAt(literal: TSESTree.ObjectExpression | TSESTree.ArrayExpression, path: readonly string[]): TSESTree.Node | null {
  let current: TSESTree.Node = literal;
  for (const key of path) {
    const inner = peelTypeWrappers(current);
    if (inner.type !== AST_NODE_TYPES.ObjectExpression && inner.type !== AST_NODE_TYPES.ArrayExpression) {
      return null;
    }
    const next = literalEntry(inner, key);
    if (next === null) {
      return null;
    }
    current = next;
  }
  return current;
}

/**
 * True when every use of a container binding only reads a fixed key path of
 * it (`holder.value`, `items[0]`, `cfg.opts.secure`) or copies it into an
 * object (`{ ...holder }`, `{ ...cfg.opts }`). It is false on any write at any
 * depth (`holder.value = x`, `cfg.opts.secure = false`, `delete holder.value`,
 * `({ a: holder.value } = src)`), a method call (`items.push(x)`), an alias
 * (`const d = holder`), and the binding handed on whole (`Object.assign(holder, x)`).
 * A nested object or array of the literal (`cfg.opts`) may only be read
 * further or copied: aliased or handed to a call it could be changed. When
 * unsure it is false. Used by taint walks only; proofs use `trustedLiteral`.
 */
function looselyReadByKey(variable: Variable, literal: TSESTree.ObjectExpression | TSESTree.ArrayExpression): boolean {
  return variable.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    const path: string[] = [];
    let end: TSESTree.Node = reference.identifier;
    for (let parent = end.parent; parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === end; parent = end.parent) {
      const key = memberKey(parent);
      if (key === null) {
        return false;
      }
      path.push(key);
      end = parent;
    }
    const use = end.parent;
    // `{ ...holder }` copies the properties and changes nothing.
    if (use?.type === AST_NODE_TYPES.SpreadElement && use.parent.type === AST_NODE_TYPES.ObjectExpression) {
      return true;
    }
    if (path.length === 0 || isWrittenHere(end)) {
      return false;
    }
    // A nested container read out whole could be changed by whoever gets it.
    const entry = entryAt(literal, path);
    const inner = entry === null ? null : peelTypeWrappers(entry);
    return (
      inner !== null &&
      inner.type !== AST_NODE_TYPES.ObjectExpression &&
      inner.type !== AST_NODE_TYPES.ArrayExpression
    );
  });
}

export type FlowMode = 'proof' | 'taint';

type ContainerLiteral = TSESTree.ObjectExpression | TSESTree.ArrayExpression;

function isContainer(node: TSESTree.Node): node is ContainerLiteral {
  return node.type === AST_NODE_TYPES.ObjectExpression || node.type === AST_NODE_TYPES.ArrayExpression;
}

/** Keys that change what an object is (`__proto__`) or reach code through it (`constructor`, `prototype`). */
const SPECIAL_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Keys a coercion calls with `this` set to the object: `${o}`, `o + ''`, `+o`, `JSON.stringify(o)`. */
const COERCION_KEYS: ReadonlySet<string> = new Set(['toString', 'valueOf', 'toJSON', 'toLocaleString']);

/** True for a literal that is a primitive: a string, number, boolean, null or bigint (not a regex). */
function isPrimitiveLiteral(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal && !('regex' in node && node.regex !== undefined);
}

/** True when an identifier names a local function or class (`function f`, `class K`, `const f = () => ...`). */
function namesFunction(node: TSESTree.Identifier, sourceCode: SourceCode): boolean {
  const variable = variableOf(node, sourceCode);
  if (variable === null) {
    return false;
  }
  return variable.defs.some((def) => {
    if (def.type === 'FunctionName' || def.type === 'ClassName') {
      return true;
    }
    const init = def.type === 'Variable' ? def.node.init : null;
    const inner = init === null ? null : peelTypeWrappers(init);
    return (
      inner?.type === AST_NODE_TYPES.FunctionExpression ||
      inner?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      inner?.type === AST_NODE_TYPES.ClassExpression
    );
  });
}

/**
 * True when a literal holds only plain data, at any depth, so no code can run
 * with `this` set to it when it is read, spread or coerced:
 *
 *   - object properties with fixed keys, none of them `__proto__`,
 *     `constructor` or `prototype`, and no method, getter or setter;
 *   - under a key a coercion calls (`toString`, `valueOf`, `toJSON`,
 *     `toLocaleString`), only a primitive literal;
 *   - array elements with no hole or spread;
 *   - leaves that are primitive literals, nested plain literals, or other
 *     expressions that are not a function, a class, or a name bound to one.
 */
function isPlainData(node: TSESTree.Node, sourceCode: SourceCode, depth = 0): boolean {
  const inner = peelTypeWrappers(node);
  if (depth > MAX_FLOW_DEPTH) {
    return false;
  }
  switch (inner.type) {
    case AST_NODE_TYPES.ObjectExpression:
      return inner.properties.every((property) => {
        if (
          property.type !== AST_NODE_TYPES.Property ||
          property.kind !== 'init' ||
          property.method ||
          property.value.type === AST_NODE_TYPES.AssignmentPattern
        ) {
          return false;
        }
        const key = propertyKey(property);
        if (key === null || SPECIAL_KEYS.has(key)) {
          return false;
        }
        if (COERCION_KEYS.has(key)) {
          return isPrimitiveLiteral(peelTypeWrappers(property.value));
        }
        return isPlainData(property.value, sourceCode, depth + 1);
      });
    case AST_NODE_TYPES.ArrayExpression:
      return inner.elements.every(
        (element) =>
          element !== null && element.type !== AST_NODE_TYPES.SpreadElement && isPlainData(element, sourceCode, depth + 1),
      );
    case AST_NODE_TYPES.FunctionExpression:
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.ClassExpression:
      return false;
    case AST_NODE_TYPES.Identifier:
      return !namesFunction(inner, sourceCode);
    default:
      return true;
  }
}

/** True when another module can reach the binding: `export const`, `export { x }`, `export default x`. */
function isExported(variable: Variable): boolean {
  const def = variable.defs[0];
  if (def?.type === 'Variable' && def.parent.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration) {
    return true;
  }
  return variable.references.some((reference) => {
    const parent = reference.identifier.parent;
    return (
      parent?.type === AST_NODE_TYPES.ExportSpecifier ||
      parent?.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
      parent?.type === AST_NODE_TYPES.TSExportAssignment
    );
  });
}

function isTypeWrapperOf(parent: TSESTree.Node | undefined, child: TSESTree.Node): boolean {
  return (
    parent !== undefined &&
    (parent.type === AST_NODE_TYPES.TSAsExpression ||
      parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      parent.type === AST_NODE_TYPES.TSTypeAssertion) &&
    parent.expression === child
  );
}

/**
 * True when `node`, a read of a literal or of an entry in it, sits in a place
 * that only reads it. `container` says whether the value read is itself an
 * object or array (or not known to be a plain value): such a value may only
 * be copied (`{ ...x }`), stringified, compared or tested, or bound to a
 * `const` that passes the same check. A plain value may also be passed on
 * (a call argument, a variable, a property, a return), since nothing can
 * change a primitive. Every other place, including any write, ends trust.
 */
function readOnlyUse(
  node: TSESTree.Node,
  container: boolean,
  entry: TSESTree.Node | null,
  sourceCode: SourceCode,
  depth: number,
): boolean {
  let current = node;
  while (current.parent !== undefined && isTypeWrapperOf(current.parent, current)) {
    current = current.parent;
  }
  const parent = current.parent;
  if (parent === undefined) {
    return false;
  }
  switch (parent.type) {
    case AST_NODE_TYPES.SpreadElement:
      return parent.parent.type === AST_NODE_TYPES.ObjectExpression;
    case AST_NODE_TYPES.TemplateLiteral:
      // A tag receives the value itself: ``tag`${x}` `` hands `x` to user code.
      return parent.parent.type !== AST_NODE_TYPES.TaggedTemplateExpression;
    case AST_NODE_TYPES.BinaryExpression:
      // On an object, `instanceof` runs `Symbol.hasInstance` and coercing
      // operators run `toString` / `valueOf`; identity and `in` run nothing.
      return (
        !container ||
        parent.operator === '===' ||
        parent.operator === '!==' ||
        (parent.operator === 'in' && parent.right === current)
      );
    case AST_NODE_TYPES.UnaryExpression:
      return container
        ? parent.operator === 'typeof' || parent.operator === '!' || parent.operator === 'void'
        : parent.operator !== 'delete';
    case AST_NODE_TYPES.IfStatement:
    case AST_NODE_TYPES.WhileStatement:
    case AST_NODE_TYPES.DoWhileStatement:
      return parent.test === current;
    case AST_NODE_TYPES.SwitchStatement:
      return parent.discriminant === current;
    case AST_NODE_TYPES.SwitchCase:
      return parent.test === current;
    case AST_NODE_TYPES.ConditionalExpression:
      return parent.test === current || !container;
    case AST_NODE_TYPES.VariableDeclarator: {
      if (parent.init !== current) {
        return false;
      }
      if (!container) {
        return true;
      }
      // `const alias = holder`: trusted only when the alias is too.
      const declaration = parent.parent;
      const literal = entry === null ? null : peelTypeWrappers(entry);
      const [alias] = sourceCode.getDeclaredVariables(parent);
      return (
        parent.id.type === AST_NODE_TYPES.Identifier &&
        declaration.type === AST_NODE_TYPES.VariableDeclaration &&
        declaration.kind === 'const' &&
        literal !== null &&
        isContainer(literal) &&
        alias !== undefined &&
        depth < MAX_FLOW_DEPTH &&
        referencesReadOnly(alias, literal, sourceCode, depth + 1)
      );
    }
    default:
      break;
  }
  if (container) {
    return false;
  }
  switch (parent.type) {
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return parent.arguments.includes(current as TSESTree.CallExpressionArgument);
    case AST_NODE_TYPES.LogicalExpression:
    case AST_NODE_TYPES.AwaitExpression:
    case AST_NODE_TYPES.ReturnStatement:
    case AST_NODE_TYPES.JSXExpressionContainer:
    case AST_NODE_TYPES.ArrayExpression:
      return true;
    case AST_NODE_TYPES.Property:
      return parent.value === current && parent.parent.type === AST_NODE_TYPES.ObjectExpression;
    case AST_NODE_TYPES.AssignmentExpression:
      return parent.right === current;
    case AST_NODE_TYPES.ArrowFunctionExpression:
      return parent.body === current;
    default:
      return false;
  }
}

/**
 * True when a `const` bound to `literal` can be trusted to still hold it: not
 * exported, plain data only, and every reference a fixed-key read (`x.k`,
 * `x[0]`, `x.a.b`) or a copy, each in a read-only place (`readOnlyUse`).
 */
function referencesReadOnly(variable: Variable, literal: ContainerLiteral, sourceCode: SourceCode, depth: number): boolean {
  if (isExported(variable) || evalReaches(variable) || !isPlainData(literal, sourceCode)) {
    return false;
  }
  return variable.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    if (reference.isWrite()) {
      return false;
    }
    const path: string[] = [];
    let end: TSESTree.Node = reference.identifier;
    for (let parent = end.parent; parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === end; parent = end.parent) {
      const key = parent.optional ? null : memberKey(parent);
      if (key === null || SPECIAL_KEYS.has(key)) {
        return false;
      }
      path.push(key);
      end = parent;
    }
    const entry = path.length === 0 ? literal : entryAt(literal, path);
    const value = entry === null ? null : peelTypeWrappers(entry);
    const container =
      value === null ||
      isContainer(value) ||
      (value.type === AST_NODE_TYPES.Literal && 'regex' in value && value.regex !== undefined);
    return readOnlyUse(end, container, entry, sourceCode, depth);
  });
}

/** The literal a `const` holds when a proof may rely on it (see `referencesReadOnly`). */
function trustedLiteral(variable: Variable, sourceCode: SourceCode): ContainerLiteral | null {
  const declarator = constDeclarator(variable);
  if (declarator?.id.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const init = peelTypeWrappers(declarator.init as TSESTree.Node);
  return isContainer(init) && referencesReadOnly(variable, init, sourceCode, 0) ? init : null;
}

/**
 * The object or array literal a container expression holds: the literal
 * itself, or a `const` bound to one that a proof may trust (`'proof'`) or
 * whose uses only read fixed keys as far as can be seen (`'taint'`).
 */
function containerLiteral(node: TSESTree.Node, sourceCode: SourceCode, mode: FlowMode = 'proof'): ContainerLiteral | null {
  const inner = peelTypeWrappers(node);
  if (isContainer(inner)) {
    return inner;
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = variableOf(inner, sourceCode);
  if (variable === null) {
    return null;
  }
  if (mode === 'proof') {
    return trustedLiteral(variable, sourceCode);
  }
  const declarator = constDeclarator(variable);
  if (declarator?.id.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const init = peelTypeWrappers(declarator.init as TSESTree.Node);
  return isContainer(init) && looselyReadByKey(variable, init) ? init : null;
}

/**
 * The object literal an expression holds, through exact moves: the literal
 * itself, a `const` bound to one that is only read by key, a helper's
 * argument, an object property, a binding read only here. Null when there is
 * none, or when some use could have changed the object on the way.
 */
export function objectLiteralOf(
  node: TSESTree.Node,
  sourceCode: SourceCode,
  mode: FlowMode = 'proof',
): TSESTree.ObjectExpression | null {
  for (const step of flowSteps(node, node, sourceCode, mode)) {
    const literal = containerLiteral(step.node, sourceCode, mode);
    if (literal !== null) {
      // A getter or method can change the object while it is read or spread.
      return literal.type === AST_NODE_TYPES.ObjectExpression && (mode === 'taint' || isPlainData(literal, sourceCode))
        ? literal
        : null;
    }
    // Past any other binding (a `let` written once, a callback's value) the
    // walk goes on only when this is its one read: nothing else can reach
    // the object through it and change it.
    const inner = peelTypeWrappers(step.node);
    if (inner.type === AST_NODE_TYPES.Identifier) {
      const variable = variableOf(inner, sourceCode);
      if (
        variable === null ||
        isExported(variable) ||
        (mode === 'proof' && evalReaches(variable)) ||
        variable.references.filter((reference) => reference.isRead()).length !== 1
      ) {
        return null;
      }
    }
  }
  return null;
}

/**
 * The value a literal holds under `key`: the last plain property of that name
 * in an object (null when a spread after it, a getter or a computed key may
 * set it instead, and for `__proto__`, `constructor` and `prototype`), or the
 * element at that index of an array with no spread or hole before it.
 */
function literalEntry(
  literal: TSESTree.ObjectExpression | TSESTree.ArrayExpression,
  key: string,
): TSESTree.Node | null {
  // `{ __proto__: p }` sets the prototype, not an own key; the others reach code.
  if (SPECIAL_KEYS.has(key)) {
    return null;
  }
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
 * parameter must be a plain name, unique among the parameters, never
 * written in the body.
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
  // `function pick(v, v)`: the last of two same-named parameters wins.
  const named = fn.params.filter((param) => param.type === AST_NODE_TYPES.Identifier && param.name === value.name);
  if (index === -1 || named.length !== 1) {
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
function destructuredValue(variable: Variable, sourceCode: SourceCode, mode: FlowMode): TSESTree.Node | null {
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
    const literal = containerLiteral(current, sourceCode, mode);
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
 * `Promise.resolve(x).then((v) => ...)`. Null otherwise. A proof walk also
 * needs the callback to take exactly one parameter, so no second name (the
 * index, the array itself: `(o, i, arr) => { arr[0].x = y }`) reaches the
 * value, and to be neither async nor a generator.
 */
function callbackValue(variable: Variable, sourceCode: SourceCode, mode: FlowMode): TSESTree.Node | null {
  const def = variable.defs[0];
  if (variable.defs.length !== 1 || def?.type !== 'Parameter' || !neverReassigned(variable)) {
    return null;
  }
  const fn = def.node;
  if (
    (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression && fn.type !== AST_NODE_TYPES.FunctionExpression) ||
    fn.params[0] !== def.name ||
    readsArguments(fn, sourceCode) ||
    (mode === 'proof' && (fn.params.length !== 1 || fn.async || fn.generator))
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
 * A taint walk takes it wherever the write sits. A proof walk takes it only
 * when the write surely ran before `read`: a statement of its own, earlier in
 * the same statement list as the read, with no condition, loop, `try` or
 * function between. Otherwise the read may see `undefined`, which is not
 * harmless for every rule (`{ ...undefined }` sets no cookie flag).
 */
function singleWriteValue(variable: Variable, read: TSESTree.Node, mode: FlowMode): TSESTree.Node | null {
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
  return mode === 'taint' || writeDominates(assignment, read) ? assignment.right : null;
}

/** True when the assignment statement runs, unconditionally, before `read` (see `singleWriteValue`). */
function writeDominates(assignment: TSESTree.AssignmentExpression, read: TSESTree.Node): boolean {
  const statement = assignment.parent;
  const list = statement.parent;
  if (
    statement.type !== AST_NODE_TYPES.ExpressionStatement ||
    statement.expression !== assignment ||
    (list?.type !== AST_NODE_TYPES.BlockStatement && list?.type !== AST_NODE_TYPES.Program)
  ) {
    return false;
  }
  let child: TSESTree.Node = read;
  for (let parent = read.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (parent === list) {
      const body = list.body as readonly TSESTree.Node[];
      return body.indexOf(statement) < body.indexOf(child);
    }
    if (
      parent.type === AST_NODE_TYPES.FunctionDeclaration ||
      parent.type === AST_NODE_TYPES.FunctionExpression ||
      parent.type === AST_NODE_TYPES.ArrowFunctionExpression
    ) {
      return false;
    }
  }
  return false;
}

/**
 * The binding an expression reads its value from: `u` for `u`, `u.pathname`
 * or `u!`. Null for anything else.
 */
function rootVariable(node: TSESTree.Node, sourceCode: SourceCode): Variable | null {
  let current = peelTypeWrappers(node);
  while (current.type === AST_NODE_TYPES.MemberExpression || current.type === AST_NODE_TYPES.ChainExpression) {
    current = peelTypeWrappers(current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.expression);
  }
  return current.type === AST_NODE_TYPES.Identifier ? variableOf(current, sourceCode) : null;
}

/**
 * One exact move back from `node`, or null when the value is not followed
 * further. `mode` picks the proof or taint rules (see the header).
 *
 * A proof move that lands on a binding which may hold another value by the
 * sink (`u` in `const box = [u]`, then `u = other`) also moves the sink to
 * where the value was taken: a check on `u` before the sink says nothing
 * about the `u` that `box[0]` captured.
 */
export function flowStep(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  mode: FlowMode = 'proof',
): FlowStep | null {
  const step = moveBack(node, sink, sourceCode, mode);
  if (step === null || mode === 'taint' || step.sink !== sink || isTypeWrapper(node)) {
    return step;
  }
  return { node: step.node, sink: takenAt(step.node, sink, sourceCode) };
}

/**
 * Where a proof about a value taken at `node` must hold: `node` itself when
 * the binding it reads may hold another value later (`u` in `const v = u`,
 * then `u = other`), else `sink`.
 */
export function takenAt(node: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node {
  const variable = rootVariable(node, sourceCode);
  return variable !== null && mayChange(variable) ? node : sink;
}

/** {@link flowStep} before the sink is moved for a binding that may change. */
function moveBack(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  mode: FlowMode,
): FlowStep | null {
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
      const literal = key === null || node.optional ? null : containerLiteral(node.object, sourceCode, mode);
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
        // A proof reaches an object or array literal only while it is trusted.
        const init = declarator.init as TSESTree.Node;
        return mode === 'proof' && isContainer(peelTypeWrappers(init)) && trustedLiteral(variable, sourceCode) === null
          ? null
          : { node: init, sink };
      }
      // An `eval` in reach may write the binding where no reference shows it.
      if (mode === 'proof' && evalReaches(variable)) {
        return null;
      }
      const destructured = destructuredValue(variable, sourceCode, mode);
      if (destructured !== null) {
        return { node: destructured, sink };
      }
      // A callback runs right where it is passed (see `isImmediateCallback`),
      // so checks before that call still count at the sink inside it.
      const received = callbackValue(variable, sourceCode, mode);
      if (received !== null) {
        return { node: received, sink };
      }
      // A write may sit in a nested function: a proof must hold where it was written.
      const written = singleWriteValue(variable, node, mode);
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
export function flowSteps(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  mode: FlowMode = 'proof',
): FlowStep[] {
  const steps: FlowStep[] = [{ node, sink }];
  const seen = new Set<TSESTree.Node>([node]);
  let current: FlowStep = steps[0] as FlowStep;
  for (let depth = 0; depth < MAX_FLOW_DEPTH; depth += 1) {
    const next = flowStep(current.node, current.sink, sourceCode, mode);
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
