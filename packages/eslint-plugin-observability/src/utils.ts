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
