/**
 * Reading the options object of a request or socket call the way the client
 * reads it: later keys win, a spread copies the keys of what it spreads, and a
 * spread or computed key the rule cannot see may set any key at all.
 */
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { isExported } from './value-flow';

type SourceCode = Readonly<TSESLint.SourceCode>;

/** One key of an options object: the node to report and the value, null when it cannot be read. */
export interface OptionEntry {
  readonly node: TSESTree.Node;
  readonly value: TSESTree.Expression | null;
}

/** The keys an options object sets, as the client sees them. */
export interface RequestOptions {
  /** Keys set after the last opaque part, by name. */
  readonly entries: ReadonlyMap<string, OptionEntry>;
  /**
   * The last spread or computed key the rule cannot read (`...req.body`,
   * `[key]: value`): any key not set after it may hold anything.
   */
  readonly opaque: TSESTree.Node | null;
}

/** True for a call that only reads the object it is handed: the request or socket call itself. */
export type ReadsOptions = (call: TSESTree.CallExpression) => boolean;

const MAX_DEPTH = 8;

type TypeWrapper =
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion;

function isTypeWrapper(node: TSESTree.Node | undefined): node is TypeWrapper {
  return (
    node?.type === AST_NODE_TYPES.TSAsExpression ||
    node?.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node?.type === AST_NODE_TYPES.TSNonNullExpression ||
    node?.type === AST_NODE_TYPES.TSTypeAssertion
  );
}

/**
 * The expression under `as T`, `satisfies T`, `!` and `<T>`, which change
 * only the type. Parentheses leave no node in the tree, so they need nothing.
 */
export function peelTypes<T extends TSESTree.Node>(node: T): TSESTree.Node {
  let current: TSESTree.Node = node;
  while (isTypeWrapper(current)) {
    current = current.expression;
  }
  return current;
}

/** The outermost type wrapper around `node` (`opts as T`), or `node` itself. */
function climbTypes(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (isTypeWrapper(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}

function propertyName(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  if (property.key.type === AST_NODE_TYPES.Literal) {
    return typeof property.key.value === 'string' || typeof property.key.value === 'number'
      ? String(property.key.value)
      : null;
  }
  if (
    property.key.type === AST_NODE_TYPES.TemplateLiteral &&
    property.key.expressions.length === 0
  ) {
    return property.key.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function propertyValue(property: TSESTree.Property): TSESTree.Expression | null {
  const value = property.value;
  if (
    property.kind !== 'init' ||
    property.method ||
    value.type === AST_NODE_TYPES.AssignmentPattern ||
    value.type === AST_NODE_TYPES.ArrayPattern ||
    value.type === AST_NODE_TYPES.ObjectPattern ||
    value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression
  ) {
    // A getter or method runs code the rule does not follow.
    return null;
  }
  return value;
}

/**
 * True when the reference only reads the object without letting anything
 * change it: an argument of a request call, a spread into another object
 * literal, or a plain property read (`opts.host` in a log line).
 */
function onlyReads(reference: TSESLint.Scope.Reference, readsOptions: ReadsOptions): boolean {
  if (reference.init === true) {
    return true;
  }
  if (reference.isWrite()) {
    return false;
  }
  // `http.get(opts as RequestOptions)` reads `opts` the same as `http.get(opts)`.
  const id = climbTypes(reference.identifier);
  const parent = id.parent;
  if (parent?.type === AST_NODE_TYPES.CallExpression) {
    return parent.callee !== id && readsOptions(parent);
  }
  if (parent?.type === AST_NODE_TYPES.SpreadElement) {
    return parent.parent.type === AST_NODE_TYPES.ObjectExpression;
  }
  if (parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === id) {
    const use = parent.parent;
    return !(
      (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === parent) ||
      (use.type === AST_NODE_TYPES.UpdateExpression && use.argument === parent) ||
      (use.type === AST_NODE_TYPES.UnaryExpression && use.operator === 'delete') ||
      (use.type === AST_NODE_TYPES.CallExpression && use.callee === parent) ||
      use.type === AST_NODE_TYPES.MemberExpression
    );
  }
  return false;
}

/**
 * The object literal a node stands for: inline, or the initializer of an
 * in-file `const` that nothing changes (every other use is a request call, a
 * spread or a plain read). `opts.host = x`, `Object.assign(opts, ...)` or
 * `helper(opts)` make it unreadable, and so does an export: an importing
 * module can change the object (`as const` freezes only the type).
 */
export function objectLiteralOf(
  node: TSESTree.Node | undefined,
  sourceCode: SourceCode,
  readsOptions: ReadsOptions,
): TSESTree.ObjectExpression | undefined {
  if (node === undefined) {
    return undefined;
  }
  const inner = peelTypes(node);
  if (inner.type === AST_NODE_TYPES.ObjectExpression) {
    return inner;
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return undefined;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(inner), inner);
  const def = variable?.defs[0];
  const init = def?.type === 'Variable' && def.node.init !== null ? peelTypes(def.node.init) : null;
  if (
    variable === null ||
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    init?.type !== AST_NODE_TYPES.ObjectExpression ||
    isExported(variable) ||
    !variable.references.every((reference) => onlyReads(reference, readsOptions))
  ) {
    return undefined;
  }
  return init;
}

/**
 * True for an in-file `const` bound to an object literal that something may
 * change before the call (`opts.host = x`, `helper(opts)`), so it is not read
 * as written.
 */
export function isChangedConstObject(
  node: TSESTree.Node | undefined,
  sourceCode: SourceCode,
  readsOptions: ReadsOptions,
): boolean {
  const inner = node === undefined ? undefined : peelTypes(node);
  if (inner?.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(inner), inner);
  const def = variable?.defs[0];
  return (
    variable !== null &&
    def?.type === 'Variable' &&
    def.node.init !== null &&
    peelTypes(def.node.init).type === AST_NODE_TYPES.ObjectExpression &&
    objectLiteralOf(inner, sourceCode, readsOptions) === undefined
  );
}

function collect(
  object: TSESTree.ObjectExpression,
  sourceCode: SourceCode,
  readsOptions: ReadsOptions,
  entries: Map<string, OptionEntry>,
  state: { opaque: TSESTree.Node | null },
  depth: number,
): void {
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      const spread = objectLiteralOf(property.argument, sourceCode, readsOptions);
      if (spread !== undefined && depth < MAX_DEPTH) {
        collect(spread, sourceCode, readsOptions, entries, state, depth + 1);
      } else {
        // `...req.body` may set any key: what came before no longer holds.
        entries.clear();
        state.opaque = property;
      }
      continue;
    }
    const name = propertyName(property);
    if (name === null) {
      entries.clear();
      state.opaque = property;
      continue;
    }
    entries.set(name, { node: property, value: propertyValue(property) });
  }
}

/** The keys an options object sets, or undefined when the node is not a readable object literal. */
export function readOptions(
  node: TSESTree.Node | undefined,
  sourceCode: SourceCode,
  readsOptions: ReadsOptions,
): RequestOptions | undefined {
  const object = objectLiteralOf(node, sourceCode, readsOptions);
  if (object === undefined) {
    return undefined;
  }
  const entries = new Map<string, OptionEntry>();
  const state: { opaque: TSESTree.Node | null } = { opaque: null };
  collect(object, sourceCode, readsOptions, entries, state, 0);
  return { entries, opaque: state.opaque };
}

/** True when a value is author-written: a literal, or a `const` (or template) built only from them. */
export function isFixedValue(node: TSESTree.Node, sourceCode: SourceCode, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  if (isTypeWrapper(node)) {
    return isFixedValue(node.expression, sourceCode, depth + 1);
  }
  if (node.type === AST_NODE_TYPES.Literal) {
    return (
      typeof node.value === 'string' ||
      typeof node.value === 'number' ||
      typeof node.value === 'boolean'
    );
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    return node.expressions.every((expression) => isFixedValue(expression, sourceCode, depth + 1));
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  return (
    variable?.defs.length === 1 &&
    def?.type === 'Variable' &&
    def.parent.kind === 'const' &&
    def.node.id.type === AST_NODE_TYPES.Identifier &&
    def.node.init !== null &&
    isFixedValue(def.node.init, sourceCode, depth + 1)
  );
}

/**
 * True when a hook value (`agent`, `lookup`, `createConnection`) is code the
 * author wrote: a literal, a function, a `new` or literal object, `this.x`, or
 * a `const`, function, class or import binding. A parameter, a `let` or a
 * property read off a runtime object is not.
 */
export function isAuthorWritten(raw: TSESTree.Node, sourceCode: SourceCode): boolean {
  const node = peelTypes(raw);
  switch (node.type) {
    case AST_NODE_TYPES.Literal:
    case AST_NODE_TYPES.FunctionExpression:
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.NewExpression:
    case AST_NODE_TYPES.ObjectExpression:
      return true;
    case AST_NODE_TYPES.MemberExpression:
      return node.object.type === AST_NODE_TYPES.ThisExpression;
    case AST_NODE_TYPES.Identifier: {
      if (node.name === 'undefined') {
        return true;
      }
      const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
      const def = variable?.defs[0];
      if (variable === null || variable.defs.length !== 1 || def === undefined) {
        return false;
      }
      return (
        def.type === 'FunctionName' ||
        def.type === 'ClassName' ||
        def.type === 'ImportBinding' ||
        (def.type === 'Variable' && def.parent.kind === 'const')
      );
    }
    default:
      return false;
  }
}

/** True for a function value: an inline function, or a binding that only ever holds one. */
export function isFunctionValue(raw: TSESTree.Node, sourceCode: SourceCode): boolean {
  const node = peelTypes(raw);
  if (
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  ) {
    return true;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  if (variable === null || variable.defs.length !== 1 || def === undefined) {
    return false;
  }
  if (def.type === 'FunctionName') {
    return true;
  }
  return (
    def.type === 'Variable' &&
    def.parent.kind === 'const' &&
    def.node.init !== null &&
    (peelTypes(def.node.init).type === AST_NODE_TYPES.FunctionExpression ||
      peelTypes(def.node.init).type === AST_NODE_TYPES.ArrowFunctionExpression)
  );
}
