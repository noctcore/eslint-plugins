import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/*
 * Shared, layout-independent helpers for the logging-discipline rules. A "logger
 * call" is matched purely structurally (no type information): a member call
 * `<logger>.<method>(...)` where `<method>` is one of the standard log levels and
 * `<logger>` resolves to a configured logger name. Both the bare-identifier form
 * (`logger.info(...)`, `console.error(...)`) and a one-level member form
 * (`this.logger.info(...)`, `app.log.warn(...)`) are recognised, so a logger held
 * on `this` or a namespace object is still seen.
 */

/** Default logger object names the rules scan for. */
export const DEFAULT_LOGGERS: readonly string[] = ['console', 'logger', 'log'];

/** Log-level method names a logger call must use to be in scope. */
export const LOG_METHODS: ReadonlySet<string> = new Set([
  'info',
  'warn',
  'error',
  'debug',
]);

/**
 * The logger "name" of a callee object: the identifier itself, or the trailing
 * property of a one-level member (`this.logger` → `logger`, `app.log` → `log`).
 */
function loggerObjectName(object: TSESTree.Node): string | undefined {
  if (object.type === AST_NODE_TYPES.Identifier) {
    return object.name;
  }
  if (
    object.type === AST_NODE_TYPES.MemberExpression &&
    !object.computed &&
    object.property.type === AST_NODE_TYPES.Identifier
  ) {
    return object.property.name;
  }
  return undefined;
}

/**
 * When `node` is a `<logger>.<method>(...)` call whose logger name is in
 * `loggers` and whose method is a log level, returns the method name; else null.
 */
export function loggerCallMethod(
  node: TSESTree.CallExpression,
  loggers: ReadonlySet<string>,
): string | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  const method = callee.property.name;
  if (!LOG_METHODS.has(method)) {
    return null;
  }
  const name = loggerObjectName(callee.object);
  if (name === undefined || !loggers.has(name)) {
    return null;
  }
  return method;
}
