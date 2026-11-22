// Logger-call detection lives in @noctcore/eslint-utils; re-exported so the
// rules keep one import site.
export {
  DEFAULT_LOGGERS,
  DEFAULT_LOG_METHODS,
  loggerCallMatcher,
  loggerCallMethod,
  loggerCallOptionProperties,
  type LoggerCallMatcher,
  type LoggerCallOptions,
} from '@noctcore/eslint-utils';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

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

/** The event field name the event rules read by default. */
export const DEFAULT_EVENT_FIELD = 'event';

/** A property's static key name, or null for a computed / non-string key. */
export function staticKeyName(property: TSESTree.Property): string | null {
  if (property.computed) {
    return null;
  }
  const key = property.key;
  if (key.type === AST_NODE_TYPES.Identifier) {
    return key.name;
  }
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string') {
    return key.value;
  }
  return null;
}

/** What a logger call's arguments say about its structured payload. */
export interface LogPayload {
  /** The object-literal arguments, in order. */
  readonly objects: readonly TSESTree.ObjectExpression[];
  /**
   * True when some argument may carry fields the rule cannot see: a spread
   * argument, or a value that is neither a literal nor an object literal (an
   * identifier, a call, a member access), which may be a context object built
   * elsewhere.
   */
  readonly opaque: boolean;
}

/** Arguments that can never be a structured payload: strings, numbers, booleans, templates. */
function isPlainValue(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal || node.type === AST_NODE_TYPES.TemplateLiteral;
}

/** Read the direct arguments of a logger call as a structured payload. */
export function logPayload(node: TSESTree.CallExpression): LogPayload {
  const objects: TSESTree.ObjectExpression[] = [];
  let opaque = false;
  for (const argument of node.arguments) {
    if (argument.type === AST_NODE_TYPES.ObjectExpression) {
      objects.push(argument);
    } else if (!isPlainValue(argument)) {
      opaque = true;
    }
  }
  return { objects, opaque };
}

/** True when an object literal spreads another value into itself. */
export function hasSpread(object: TSESTree.ObjectExpression): boolean {
  return object.properties.some((property) => property.type === AST_NODE_TYPES.SpreadElement);
}

/** The last property of an object literal whose static key is `name`, or null. */
export function findProperty(
  object: TSESTree.ObjectExpression,
  name: string,
): TSESTree.Property | null {
  let found: TSESTree.Property | null = null;
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.Property && staticKeyName(property) === name) {
      found = property;
    }
  }
  return found;
}
