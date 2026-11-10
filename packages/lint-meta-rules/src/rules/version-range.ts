/*
 * The slice of semver the supply-chain rules need, with no dependency. The
 * grammar they read is small and closed: override selectors are `<x`, `<=x`,
 * `>=a <b`, `>=a <=b` or `=x`, and targets and declared ranges are `^x`, `~x`
 * or a bare version. Anything outside that returns `null`, and the calling rule
 * reports the unreadable string rather than quietly passing it.
 */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated prerelease identifiers, empty for a release. */
  readonly prerelease: readonly string[];
}

export type ComparatorOp = '<' | '<=' | '>' | '>=' | '=';

export interface Comparator {
  readonly op: ComparatorOp;
  readonly version: Version;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMPARATOR_PATTERN = /^(<=|>=|<|>|=)?\s*(.+)$/u;

/** A version, or `null` when the text is not a plain `x.y.z` release or prerelease. */
export function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks any prerelease of the same triple (semver 11).
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/u.test(left);
    const rightNumeric = /^\d+$/u.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

/** Negative when `a` sorts before `b`, positive when after, zero when equal. */
export function compareVersions(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

/**
 * A whitespace-separated conjunction of comparators (`>=10.1.1 <=10.2.1`), or
 * `null` when any clause is not one of the supported operators over a plain
 * version. A bare version means `=`.
 */
export function parseRange(text: string): Comparator[] | null {
  const clauses = text.trim().split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) return null;
  const comparators: Comparator[] = [];
  for (const clause of clauses) {
    const match = COMPARATOR_PATTERN.exec(clause);
    const version = match?.[2] === undefined ? null : parseVersion(match[2]);
    if (version === null) return null;
    comparators.push({ op: (match?.[1] as ComparatorOp | undefined) ?? '=', version });
  }
  return comparators;
}

function satisfiesComparator(version: Version, comparator: Comparator): boolean {
  const ordering = compareVersions(version, comparator.version);
  switch (comparator.op) {
    case '<':
      return ordering < 0;
    case '<=':
      return ordering <= 0;
    case '>':
      return ordering > 0;
    case '>=':
      return ordering >= 0;
    case '=':
      return ordering === 0;
  }
}

/** Whether a version satisfies every comparator of a parsed range. */
export function satisfies(version: Version, range: readonly Comparator[]): boolean {
  return range.every((comparator) => satisfiesComparator(version, comparator));
}

/**
 * The lowest version an override target can install: the version inside `^x`,
 * `~x`, `>=x` or a bare `x`. A caret target can only resolve upward, so this is
 * what a pin is compared against.
 */
export function targetLowerBound(target: string): Version | null {
  return parseVersion(target.trim().replace(/^(?:\^|~|>=|=)/u, ''));
}

/**
 * The exclusive upper bound of a `^x.y.z` or `~x.y.z` range, or `null` for any
 * other shape. `^0.2.0` stops before `0.3.0` and `^1.2.0` before `2.0.0`: a
 * caret on a 0.x version does not cross the minor.
 */
export function caretOrTildeCeiling(range: string): Version | null {
  const match = /^([~^])\s*v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(range.trim());
  if (match === null) return null;
  const [major, minor, patch] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const at = (a: number, b: number, c: number): Version => ({ major: a, minor: b, patch: c, prerelease: [] });
  if (match[1] === '~') return at(major, minor + 1, 0);
  if (major > 0) return at(major + 1, 0, 0);
  if (minor > 0) return at(0, minor + 1, 0);
  return at(0, 0, patch + 1);
}

/**
 * An override key split into the package it rewrites and its optional version
 * selector. `react` has no selector; `@xmldom/xmldom@<0.8.15` has one, and the
 * leading `@` of a scoped name is not the separator.
 */
export function splitOverrideKey(key: string): { name: string; selector: string | null } {
  const separator = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  if (separator === -1) return { name: key, selector: null };
  return { name: key.slice(0, separator), selector: key.slice(separator + 1) };
}
