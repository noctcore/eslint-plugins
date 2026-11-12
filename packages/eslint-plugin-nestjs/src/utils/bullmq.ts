import { calleePath } from '@noctcore/eslint-utils';
import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/** The module the worker rules recognise imports from. */
export const BULLMQ_MODULE = 'bullmq';

/** The BullMQ classes the rules can ask about. */
export type BullmqClass = 'Worker' | 'Queue' | 'QueueEvents';

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

/** The value of a string literal or of a template literal with no expressions, else null. */
export function eventName(node: TSESTree.Node | undefined): string | null {
  if (node?.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') return node.value;
  if (node?.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** The receiver of `<receiver>.on(...)`, or null when `node` is not such a call. */
export function onCallReceiver(node: TSESTree.CallExpression): TSESTree.Expression | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    callee.property.name !== 'on'
  ) {
    return null;
  }
  return callee.object;
}

export interface ListenerChain {
  /** The outermost `.on(...)` call chained on the expression, or the expression itself. */
  readonly top: TSESTree.Expression;
  /** The events those chained calls subscribe to, where the name is a literal. */
  readonly events: readonly string[];
}

/**
 * The `.on(...)` calls chained directly on `node`, as in
 * `new Worker(...).on('failed', f).on('error', g)`. BullMQ's `on` returns the
 * worker, so the chain's value is still the worker.
 */
export function listenerChain(node: TSESTree.Expression): ListenerChain {
  let top: TSESTree.Expression = node;
  const events: string[] = [];
  for (;;) {
    const member = top.parent;
    if (member?.type !== AST_NODE_TYPES.MemberExpression || member.object !== top) break;
    const call = member.parent;
    if (call?.type !== AST_NODE_TYPES.CallExpression || call.callee !== member) break;
    if (onCallReceiver(call) === null) break;
    const event = eventName(call.arguments[0]);
    if (event !== null) events.push(event);
    top = call;
  }
  return { top, events };
}

/**
 * The key a worker is tracked under: `w` or `this.worker`. Null for computed
 * access, `#private` fields and any other shape, which are not tracked.
 */
export function bindingKey(node: TSESTree.Node): string | null {
  return calleePath(node, { allowThis: true });
}

/**
 * Where a constructed worker ends up: `bound` to a key the file can attach a
 * listener through, a `bare` statement nothing can reach, an expression that
 * `escapes` to a caller or a callee, or any `other` place.
 */
export type WorkerBinding =
  | { readonly kind: 'bound'; readonly key: string }
  | { readonly kind: 'bare' | 'escapes' | 'other' };

function isTypeWrapper(node: TSESTree.Node, child: TSESTree.Node): boolean {
  return (
    (node.type === AST_NODE_TYPES.TSAsExpression ||
      node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      node.type === AST_NODE_TYPES.TSNonNullExpression ||
      node.type === AST_NODE_TYPES.TSTypeAssertion) &&
    node.expression === child
  );
}

/** Classifies the place `top` (a worker expression, see `listenerChain`) is put. */
export function workerBinding(top: TSESTree.Node): WorkerBinding {
  let current = top;
  let parent = current.parent;
  while (parent !== undefined && isTypeWrapper(parent, current)) {
    current = parent;
    parent = current.parent;
  }
  if (parent === undefined) return { kind: 'other' };
  switch (parent.type) {
    case AST_NODE_TYPES.VariableDeclarator:
      return parent.init === current && parent.id.type === AST_NODE_TYPES.Identifier
        ? { kind: 'bound', key: parent.id.name }
        : { kind: 'other' };
    case AST_NODE_TYPES.AssignmentExpression: {
      const key = parent.right === current ? bindingKey(parent.left) : null;
      return key === null ? { kind: 'other' } : { kind: 'bound', key };
    }
    case AST_NODE_TYPES.PropertyDefinition:
      return parent.value === current &&
        !parent.static &&
        !parent.computed &&
        parent.key.type === AST_NODE_TYPES.Identifier
        ? { kind: 'bound', key: `this.${parent.key.name}` }
        : { kind: 'other' };
    case AST_NODE_TYPES.ExpressionStatement:
      return { kind: 'bare' };
    case AST_NODE_TYPES.ReturnStatement:
      return { kind: 'escapes' };
    case AST_NODE_TYPES.ArrowFunctionExpression:
      return parent.body === current ? { kind: 'escapes' } : { kind: 'other' };
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return parent.arguments.includes(current as TSESTree.CallExpressionArgument)
        ? { kind: 'escapes' }
        : { kind: 'other' };
    default:
      return { kind: 'other' };
  }
}
