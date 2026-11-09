import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

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

/**
 * Default log-level method names a logger call must use to be in scope. Covers
 * `console.log`, Nest's `log` / `verbose` / `fatal` and pino's `trace` / `fatal`
 * as well as the four common levels.
 */
export const DEFAULT_LOG_METHODS: readonly string[] = [
  'info',
  'warn',
  'error',
  'debug',
  'log',
  'trace',
  'fatal',
  'verbose',
];

/** The `loggers` and `methods` option shared by every logger rule. */
export interface LoggerCallOptions {
  readonly loggers?: readonly string[];
  readonly methods?: readonly string[];
}

/** JSON-schema properties for {@link LoggerCallOptions}. */
export const loggerCallOptionProperties: Record<string, JSONSchema4> = {
  loggers: {
    type: 'array',
    items: { type: 'string' },
  },
  methods: {
    type: 'array',
    items: { type: 'string' },
  },
};

/** The logger names and method names in effect for a rule's options. */
export interface LoggerCallMatcher {
  readonly loggers: ReadonlySet<string>;
  readonly methods: ReadonlySet<string>;
}

/** Resolve the `loggers` and `methods` options, falling back to the defaults. */
export function loggerCallMatcher(options: LoggerCallOptions | undefined): LoggerCallMatcher {
  return {
    loggers: new Set(options?.loggers ?? DEFAULT_LOGGERS),
    methods: new Set(options?.methods ?? DEFAULT_LOG_METHODS),
  };
}

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
 * `matcher.loggers` and whose method is in `matcher.methods`, returns the method
 * name; else null.
 */
export function loggerCallMethod(
  node: TSESTree.CallExpression,
  matcher: LoggerCallMatcher,
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
  if (!matcher.methods.has(method)) {
    return null;
  }
  const name = loggerObjectName(callee.object);
  if (name === undefined || !matcher.loggers.has(name)) {
    return null;
  }
  return method;
}

/** Lowercased camelCase / snake_case / kebab segments of a name. */
export function nameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Name with all non-alphanumerics stripped, lowercased (`api_key` → `apikey`). */
export function compactName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build a name matcher from a list of name patterns. A single-word pattern
 * (`token`) matches a camelCase / snake_case SEGMENT (`accessToken`,
 * `access_token`) but not a longer word that merely contains it (`tokenize`). A
 * multi-word pattern (`apiKey`) matches on the compacted name (`myApiKey` →
 * `myapikey` contains `apikey`).
 */
export function makeNameMatcher(patterns: readonly string[]): (name: string) => boolean {
  const single: string[] = [];
  const multi: string[] = [];
  for (const pattern of patterns) {
    const segs = nameSegments(pattern);
    if (segs.length <= 1) {
      single.push(compactName(pattern));
    } else {
      multi.push(compactName(pattern));
    }
  }
  return (name: string): boolean => {
    const segs = new Set(nameSegments(name));
    if (single.some((p) => segs.has(p))) {
      return true;
    }
    const flat = compactName(name);
    return multi.some((p) => flat.includes(p));
  };
}
