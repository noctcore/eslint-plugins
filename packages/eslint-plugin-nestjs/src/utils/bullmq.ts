import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { directProperty, isUndefined } from './queue';

/** The module the worker rules recognise imports from. */
export const BULLMQ_MODULE = 'bullmq';

/** The BullMQ classes the rules can ask about. */
export type BullmqClass = 'Worker' | 'Queue' | 'QueueEvents' | 'FlowProducer';

export type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;

type FunctionValue = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

type TypeWrapper =
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion;

/**
 * The name `identifier` is imported under from `bullmq`, following a rename
 * (`import { Worker as BullWorker } from 'bullmq'` gives `Worker` for
 * `BullWorker`). Resolved through scope, so a local of the same name that
 * shadows the import is not mistaken for it. Null for anything else, a
 * type-only import included.
 */
export function bullmqImportName(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
): string | null {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def?.type !== 'ImportBinding' || def.node.type !== AST_NODE_TYPES.ImportSpecifier) return null;
  const declaration = def.parent;
  if (
    declaration.type !== AST_NODE_TYPES.ImportDeclaration ||
    declaration.source.value !== BULLMQ_MODULE ||
    declaration.importKind === 'type' ||
    def.node.importKind === 'type'
  ) {
    return null;
  }
  const imported = def.node.imported;
  return imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
}

/** True for `new <C>(...)` where `<C>` is the `bullmq` export `className`, renamed or not. */
export function isBullmqNew(
  node: TSESTree.Node,
  className: BullmqClass,
  scope: TSESLint.Scope.Scope,
): node is TSESTree.NewExpression {
  return (
    node.type === AST_NODE_TYPES.NewExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    bullmqImportName(node.callee, scope) === className
  );
}

function isTypeWrapper(node: TSESTree.Node): node is TypeWrapper {
  return (
    node.type === AST_NODE_TYPES.TSAsExpression ||
    node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSTypeAssertion
  );
}

/** `node` without the type-only wrappers around it: `w` for `(w as Worker)!`. */
export function stripTypeWrappers(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (isTypeWrapper(current)) current = current.expression;
  return current;
}

/** The outermost type-only wrapper around `node`, or `node` itself. */
export function outermostTypeWrapper(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (current.parent !== undefined && isTypeWrapper(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}

/** The class whose instance member has `fn` as its value, or null. */
function memberClass(fn: FunctionValue): ClassNode | null {
  const member = fn.parent;
  if (
    (member.type !== AST_NODE_TYPES.MethodDefinition &&
      member.type !== AST_NODE_TYPES.PropertyDefinition) ||
    member.value !== fn ||
    member.static
  ) {
    return null;
  }
  return member.parent.parent;
}

/**
 * The class whose instance `this` refers to at `node`: the nearest enclosing
 * function that is not an arrow must be an instance method (or an
 * arrow-valued field) of it, or `node` sits in an instance field initialiser.
 * A plain nested `function`, a static member, a static block and the top
 * level of the file bind `this` to something else, so they give null.
 */
export function thisClass(node: TSESTree.Node): ClassNode | null {
  let child = node;
  for (let current = node.parent; current !== undefined; child = current, current = current.parent) {
    switch (current.type) {
      case AST_NODE_TYPES.ArrowFunctionExpression: {
        const owner = memberClass(current);
        if (owner !== null) return owner;
        break;
      }
      case AST_NODE_TYPES.FunctionExpression:
        return memberClass(current);
      case AST_NODE_TYPES.PropertyDefinition:
        if (current.value === child) return current.static ? null : current.parent.parent;
        break;
      case AST_NODE_TYPES.FunctionDeclaration:
      case AST_NODE_TYPES.StaticBlock:
      case AST_NODE_TYPES.ClassBody:
      case AST_NODE_TYPES.Program:
        return null;
      default:
        break;
    }
  }
  return null;
}

/**
 * The `this` a local stands for when it was declared as `const self = this`
 * and is never reassigned; null for any other variable.
 */
export function thisAlias(variable: TSESLint.Scope.Variable | null): TSESTree.ThisExpression | null {
  if (variable === null || variable.defs.length !== 1) return null;
  const def = variable.defs[0];
  if (def?.type !== 'Variable' || def.node.id.type !== AST_NODE_TYPES.Identifier || def.node.init === null) {
    return null;
  }
  if (variable.references.filter((reference) => reference.isWrite()).length > 1) return null;
  const init = stripTypeWrappers(def.node.init);
  return init.type === AST_NODE_TYPES.ThisExpression ? init : null;
}

/** True for `this`, or a local that stands for it (`const self = this`), with type wrappers ignored. */
export function isThisLike(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const inner = stripTypeWrappers(node);
  if (inner.type === AST_NODE_TYPES.ThisExpression) return true;
  if (inner.type !== AST_NODE_TYPES.Identifier) return false;
  return thisAlias(ASTUtils.findVariable(sourceCode.getScope(inner), inner)) !== null;
}

/**
 * The class an `extends` clause names, when this file declares it with a
 * body; null for a base from another module, a `declare class` (its
 * implementation lives elsewhere) and any expression the rule cannot follow.
 */
function declaredClass(node: TSESTree.Expression, sourceCode: Readonly<TSESLint.SourceCode>): ClassNode | null {
  const inner = stripTypeWrappers(node);
  if (inner.type === AST_NODE_TYPES.ClassExpression) return inner;
  if (inner.type !== AST_NODE_TYPES.Identifier) return null;
  const def = ASTUtils.findVariable(sourceCode.getScope(inner), inner)?.defs[0];
  if (def?.type === 'ClassName') return def.node.type === AST_NODE_TYPES.ClassDeclaration && def.node.declare ? null : def.node;
  if (def?.type === 'Variable' && def.node.init !== null) {
    const init = stripTypeWrappers(def.node.init);
    if (init.type === AST_NODE_TYPES.ClassExpression) return init;
  }
  return null;
}

export interface ClassChain {
  /** The class and the bases it inherits from that this file declares, nearest first. */
  readonly classes: readonly ClassNode[];
  /** False when a base comes from elsewhere, so code the rule cannot read is inherited. */
  readonly complete: boolean;
}

/** The inheritance chain of `owner` as far as this file declares it. */
export function classChain(owner: ClassNode, sourceCode: Readonly<TSESLint.SourceCode>): ClassChain {
  const classes: ClassNode[] = [];
  let current: ClassNode | null = owner;
  while (current !== null) {
    if (classes.includes(current)) return { classes, complete: false };
    classes.push(current);
    if (current.superClass === null) return { classes, complete: true };
    current = declaredClass(current.superClass, sourceCode);
  }
  return { classes, complete: false };
}

/** A listener whose event name is not known statically, so it may be any event. */
export const ANY_EVENT: unique symbol = Symbol('any event');

export type ListenerEvent = string | typeof ANY_EVENT;

/**
 * The event a listener call subscribes to, from its first argument: the
 * static string value (a literal, a template with no expressions, a `const`
 * holding one; `as const` and other type wrappers are ignored), `ANY_EVENT`
 * when the value cannot be known statically, and null when there is no
 * argument or the value is not a string.
 */
export function listenerEvent(
  argument: TSESTree.CallExpressionArgument | undefined,
  scope: TSESLint.Scope.Scope,
): ListenerEvent | null {
  if (argument === undefined) return null;
  if (argument.type === AST_NODE_TYPES.SpreadElement) return ANY_EVENT;
  const result = ASTUtils.getStaticValue(stripTypeWrappers(argument), scope);
  if (result === null) return ANY_EVENT;
  return typeof result.value === 'string' ? result.value : null;
}

/**
 * The methods that subscribe a lasting listener: `addListener` is the
 * emitter's alias of `on`, and `prependListener` only changes the order.
 */
const LISTENER_METHODS: ReadonlySet<string> = new Set(['on', 'addListener', 'prependListener']);

/**
 * The receiver of a listener call such as `<receiver>.on(...)`, or null when
 * `node` is not one. `once` and `prependOnceListener` are not listeners here:
 * they hear one event and miss every later one.
 */
export function listenerReceiver(node: TSESTree.CallExpression): TSESTree.Expression | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    !LISTENER_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  return callee.object;
}

export interface ListenerChain {
  /** The outermost listener call chained on the expression, or the expression itself. */
  readonly top: TSESTree.Expression;
  /** The listener calls chained on the expression, innermost first. */
  readonly calls: readonly TSESTree.CallExpression[];
}

/**
 * The listener calls chained directly on `node`, as in
 * `new Worker(...).on('failed', f).on('error', g)`. BullMQ's `on` returns the
 * worker, so the chain's value is still the worker.
 */
export function listenerChain(node: TSESTree.Expression): ListenerChain {
  let top: TSESTree.Expression = node;
  const calls: TSESTree.CallExpression[] = [];
  for (;;) {
    const member = top.parent;
    if (member?.type !== AST_NODE_TYPES.MemberExpression || member.object !== top) break;
    const call = member.parent;
    if (call?.type !== AST_NODE_TYPES.CallExpression || call.callee !== member) break;
    if (listenerReceiver(call) === null) break;
    calls.push(call);
    top = call;
  }
  return { top, calls };
}

/** A binding a worker can be held in and listened to through. */
export interface BindingRef {
  /**
   * The binding's identity: the same variable, or the same field of the same
   * class, gives the same key from any scope, and two variables that share a
   * name in different scopes give different keys.
   */
  readonly key: string;
  /** How the source names it, for messages: `w`, `this.worker`. */
  readonly name: string;
  /** For a binding read through `this`: the class the `this` belongs to. */
  readonly owner?: ClassNode;
  /** For a binding read through `this`: the member path after it, `.worker` for `this.worker`. */
  readonly path?: string;
}

export interface BindingResolver {
  /**
   * The binding an expression reads: `w`, `this.worker`, `a.b`, with type
   * wrappers ignored. A variable is resolved through scope, `this` (or a
   * `const self = this` alias) to the class it is an instance of. Null for
   * computed access, `#private` fields, calls and any other shape, which are
   * not tracked.
   */
  ref(node: TSESTree.Node): BindingRef | null;
  /** The instance field `field` of `owner`, as `this.<field>` reads it inside the class. */
  fieldRef(owner: ClassNode, field: string): BindingRef;
  /** The property `property` of `parent`, as `<parent>.<property>` reads it. */
  memberRef(parent: BindingRef, property: string): BindingRef;
  /** The key of a `this` binding's member path read on an instance of `owner` instead. */
  keyIn(ref: BindingRef, owner: ClassNode): string | null;
}

/** Resolves expressions to bindings for one file; keys are only comparable within it. */
export function createBindingResolver(sourceCode: Readonly<TSESLint.SourceCode>): BindingResolver {
  const ids = new WeakMap<object, number>();
  let nextId = 0;

  function idOf(value: object): number {
    const known = ids.get(value);
    if (known !== undefined) return known;
    nextId += 1;
    ids.set(value, nextId);
    return nextId;
  }

  function classKey(owner: ClassNode, path: string): string {
    return `class:${idOf(owner)}${path}`;
  }

  function classRef(owner: ClassNode): BindingRef {
    return { key: classKey(owner, ''), name: 'this', owner, path: '' };
  }

  function memberRef(parent: BindingRef, property: string): BindingRef {
    const ref = { key: `${parent.key}.${property}`, name: `${parent.name}.${property}` };
    return parent.owner === undefined || parent.path === undefined
      ? ref
      : { ...ref, owner: parent.owner, path: `${parent.path}.${property}` };
  }

  function ref(node: TSESTree.Node): BindingRef | null {
    const inner = stripTypeWrappers(node);
    switch (inner.type) {
      case AST_NODE_TYPES.Identifier: {
        const variable = ASTUtils.findVariable(sourceCode.getScope(inner), inner);
        const self = thisAlias(variable);
        if (self !== null) return ref(self);
        return {
          key: variable === null ? `global:${inner.name}` : `var:${idOf(variable)}`,
          name: inner.name,
        };
      }
      case AST_NODE_TYPES.ThisExpression: {
        const owner = thisClass(inner);
        return owner === null ? { key: 'this', name: 'this' } : classRef(owner);
      }
      case AST_NODE_TYPES.MemberExpression: {
        if (inner.computed || inner.property.type !== AST_NODE_TYPES.Identifier) return null;
        const parent = ref(inner.object);
        return parent === null ? null : memberRef(parent, inner.property.name);
      }
      default:
        return null;
    }
  }

  return {
    ref,
    fieldRef: (owner, field) => memberRef(classRef(owner), field),
    memberRef,
    keyIn: (binding, owner) => (binding.path === undefined ? null : classKey(owner, binding.path)),
  };
}

/** The assignment operators that store a new worker: plain and the logical lazy forms. */
export const WORKER_ASSIGNMENT_OPERATORS: ReadonlySet<string> = new Set(['=', '??=', '||=']);

/**
 * Where a constructed worker ends up: `bound` to the bindings the file can
 * attach a listener through, a `bare` statement nothing can reach, an
 * expression that `escapes` to a caller or a callee, or any `other` place.
 */
export type WorkerBinding =
  | { readonly kind: 'bound'; readonly refs: readonly BindingRef[] }
  | { readonly kind: 'bare' | 'escapes' | 'other' };

/** How the expression `value` is used by its parent, when it is not stored in a binding. */
function usage(value: TSESTree.Node): 'bare' | 'escapes' | 'other' {
  const parent = value.parent;
  switch (parent?.type) {
    case AST_NODE_TYPES.ExpressionStatement:
      return 'bare';
    case AST_NODE_TYPES.ReturnStatement:
      return 'escapes';
    case AST_NODE_TYPES.ArrowFunctionExpression:
      return parent.body === value ? 'escapes' : 'other';
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return parent.arguments.includes(value as TSESTree.CallExpressionArgument) ? 'escapes' : 'other';
    default:
      return 'other';
  }
}

/**
 * Classifies the place `top` (a worker expression, see `listenerChain`) is
 * put. A chained assignment binds every name in it, so
 * `const worker = this.worker = new Worker(...)` is bound to both.
 */
export function workerBinding(top: TSESTree.Node, resolver: BindingResolver): WorkerBinding {
  const refs: BindingRef[] = [];
  const bound = (): WorkerBinding => (refs.length > 0 ? { kind: 'bound', refs } : { kind: 'other' });
  let current = outermostTypeWrapper(top);
  for (;;) {
    const parent = current.parent;
    if (parent?.type === AST_NODE_TYPES.VariableDeclarator) {
      const ref = parent.init === current && parent.id.type === AST_NODE_TYPES.Identifier ? resolver.ref(parent.id) : null;
      if (ref !== null) refs.push(ref);
      return bound();
    }
    if (parent?.type === AST_NODE_TYPES.PropertyDefinition) {
      if (
        parent.value === current &&
        !parent.static &&
        !parent.computed &&
        parent.key.type === AST_NODE_TYPES.Identifier
      ) {
        refs.push(resolver.fieldRef(parent.parent.parent, parent.key.name));
      }
      return bound();
    }
    if (
      parent?.type === AST_NODE_TYPES.AssignmentExpression &&
      parent.right === current &&
      WORKER_ASSIGNMENT_OPERATORS.has(parent.operator)
    ) {
      const ref = resolver.ref(parent.left);
      if (ref === null) return bound();
      refs.push(ref);
      current = outermostTypeWrapper(parent);
      continue;
    }
    const kind = usage(current);
    if (refs.length === 0) return { kind };
    return kind === 'escapes' ? { kind } : bound();
  }
}

/**
 * Every key a binding can be stored under in this file: its own key and, for a
 * `this` binding, the same member path on each base class this file declares,
 * so `this.queue` read in a subclass finds the field its base assigns.
 */
export function bindingKeys(
  ref: BindingRef,
  resolver: BindingResolver,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string[] {
  const keys = [ref.key];
  if (ref.owner === undefined) return keys;
  for (const owner of classChain(ref.owner, sourceCode).classes) {
    const key = resolver.keyIn(ref, owner);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The `defaultJobOptions` a queue is constructed with: `known` with the
 * object literal, or with null when the queue states none, and `unknown` when
 * the options are built in a way the rule cannot read.
 */
export type QueueDefaults =
  | { readonly kind: 'known'; readonly options: TSESTree.ObjectExpression | null }
  | { readonly kind: 'unknown' };

const UNKNOWN_DEFAULTS: QueueDefaults = { kind: 'unknown' };
const NO_DEFAULTS: QueueDefaults = { kind: 'known', options: null };

/**
 * Reads `defaultJobOptions` off `new Queue(name, options)`. Only an options
 * object literal is read; a spread argument, options passed by name, a spread
 * in the options that may carry the key, and a `defaultJobOptions` value that
 * is not an object literal all give `unknown`.
 */
export function queueDefaultJobOptions(node: TSESTree.NewExpression): QueueDefaults {
  if (node.arguments.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement)) {
    return UNKNOWN_DEFAULTS;
  }
  const second = node.arguments[1];
  if (second === undefined) return NO_DEFAULTS;
  const options = stripTypeWrappers(second);
  if (options.type !== AST_NODE_TYPES.ObjectExpression) return UNKNOWN_DEFAULTS;
  const property = directProperty(options, 'defaultJobOptions');
  if (property === undefined) {
    const spread = options.properties.some((member) => member.type === AST_NODE_TYPES.SpreadElement);
    return spread ? UNKNOWN_DEFAULTS : NO_DEFAULTS;
  }
  if (property.shorthand) return UNKNOWN_DEFAULTS;
  const value = stripTypeWrappers(property.value);
  if (value.type === AST_NODE_TYPES.ObjectExpression) return { kind: 'known', options: value };
  return isUndefined(value) ? NO_DEFAULTS : UNKNOWN_DEFAULTS;
}

/** The bullmq queues a file constructs, keyed by the bindings they are stored in. */
export interface QueueDefaultsIndex {
  /** Records `node` when it is a bullmq `new Queue(...)` stored in a binding; anything else is ignored. */
  record(node: TSESTree.NewExpression): void;
  /**
   * The defaults of the queue `receiver` reads, or null when no recorded queue
   * is stored in that binding. A binding two queues are stored in gives
   * `unknown`. Only meaningful once the whole file has been visited, since a
   * queue may be constructed after the code that uses it.
   */
  lookup(receiver: TSESTree.Node): QueueDefaults | null;
}

export function createQueueDefaultsIndex(
  sourceCode: Readonly<TSESLint.SourceCode>,
  resolver: BindingResolver,
): QueueDefaultsIndex {
  const byKey = new Map<string, QueueDefaults>();

  return {
    record(node): void {
      if (!isBullmqNew(node, 'Queue', sourceCode.getScope(node))) return;
      const binding = workerBinding(listenerChain(node).top, resolver);
      if (binding.kind !== 'bound') return;
      const defaults = queueDefaultJobOptions(node);
      for (const ref of binding.refs) {
        byKey.set(ref.key, byKey.has(ref.key) ? UNKNOWN_DEFAULTS : defaults);
      }
    },
    lookup(receiver): QueueDefaults | null {
      const ref = resolver.ref(receiver);
      if (ref === null) return null;
      for (const key of bindingKeys(ref, resolver, sourceCode)) {
        const defaults = byKey.get(key);
        if (defaults !== undefined) return defaults;
      }
      return null;
    },
  };
}
