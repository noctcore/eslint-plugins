import {
  AST_NODE_TYPES,
  calleeName,
  unwrapTypeWrappers,
  type TSESTree,
} from '@noctcore/eslint-utils';

/** The schema entry both rules share for the files that may hold calendar code. */
export const allowInSchema = {
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description:
    'Globs of the files exempt from the rule (your calendar module and its tests), matched against the absolute path and the path relative to the working directory or workspace root (`src/calendar/**` or `**/calendar/**`). Empty by default.',
} as const;

/** The schema entry both rules share for the module named in the message. */
export const calendarModuleSchema = {
  type: 'string',
  minLength: 1,
  description:
    'Import path of your calendar module (for example `@acme/shared/calendar`), named in the message so the fix points at it. Leave it out for a generic message.',
} as const;

/** The closing sentence of every report: where the calendar helpers live. */
export function calendarHint(calendarModule: string | undefined): string {
  return calendarModule === undefined
    ? 'Use a helper from your calendar module, or add the missing one there.'
    : `Use a helper from \`${calendarModule}\`, or add the missing one there.`;
}

/** The node under `x?.y` chains and the type wrappers (`x!`, `x as T`, `x satisfies T`). */
export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = unwrapTypeWrappers(node);
  while (current.type === AST_NODE_TYPES.ChainExpression) {
    current = unwrapTypeWrappers(current.expression);
  }
  return current;
}

/**
 * The called method name of `receiver.name(...)` and `receiver['name'](...)`, or
 * null for any other call shape. The string-key form is matched too, so a
 * computed access cannot hide the call.
 */
export function calledMethod(node: TSESTree.Node): string | null {
  const call = unwrap(node);
  if (call.type !== AST_NODE_TYPES.CallExpression) return null;
  const callee = unwrap(call.callee);
  if (callee.type !== AST_NODE_TYPES.MemberExpression) return null;
  if (callee.computed) return staticString(callee.property);
  return calleeName(callee);
}

/** True for a call on the global `Date`, such as `Date.now()` or `Date.UTC(...)`. */
export function isDateStaticCall(node: TSESTree.Node, method: string): boolean {
  const call = unwrap(node);
  if (call.type !== AST_NODE_TYPES.CallExpression) return false;
  const callee = unwrap(call.callee);
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'Date' &&
    calleeName(callee) === method
  );
}

/** The value of a string literal or an expression-free template literal, else null. */
export function staticString(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') return node.value;
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** The value of a number literal, else null. */
export function numberValue(node: TSESTree.Node): number | null {
  return node.type === AST_NODE_TYPES.Literal && typeof node.value === 'number' ? node.value : null;
}
