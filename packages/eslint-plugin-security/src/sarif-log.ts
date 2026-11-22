import type { ESLint, Linter } from 'eslint';

/*
 * A small SARIF 2.1.0 writer for ESLint results, with no dependency.
 *
 * Every rule that a result points at becomes a `reportingDescriptor` carrying
 * its description, docs URL and, when its `meta.docs` declares them, the tags
 * code scanning tools read (`security`, `external/cwe/cwe-078`,
 * `external/owasp/a03:2021`) and a `security-severity`. It reads the meta of
 * any rule, so a rule from another plugin with `meta.docs.cwe` is tagged too.
 *
 * Paths are written relative to the working directory under the `SRCROOT`
 * base id, which `originalUriBaseIds` resolves to the working directory as an
 * absolute file URI. A file outside the working directory, or every file when
 * `absoluteUris` is set, gets an absolute file URI instead.
 */

export const SARIF_SCHEMA_URI =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';
export const SRCROOT = 'SRCROOT';

export interface SarifOptions {
  /** The directory paths are relative to. Defaults to `data.cwd`, then `process.cwd()`. */
  readonly cwd?: string;
  /** Write every location as an absolute file URI and leave out `originalUriBaseIds`. */
  readonly absoluteUris?: boolean;
}

interface RuleDocs {
  readonly description?: unknown;
  readonly url?: unknown;
  readonly category?: unknown;
  readonly cwe?: readonly string[];
  readonly owasp?: readonly string[];
  readonly securitySeverity?: unknown;
}

type RulesMeta = Readonly<Record<string, { readonly docs?: unknown } | undefined>>;

interface ArtifactLocation {
  uri: string;
  uriBaseId?: string;
  index?: number;
}

interface Region {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

interface Location {
  physicalLocation: { artifactLocation: ArtifactLocation; region?: Region };
}

interface ReportingDescriptor {
  id: string;
  shortDescription?: { text: string };
  helpUri?: string;
  properties?: Record<string, unknown>;
}

interface Suppression {
  kind: 'inSource' | 'external';
  justification?: string;
}

interface Result {
  ruleId?: string;
  ruleIndex?: number;
  level: 'error' | 'warning';
  message: { text: string };
  locations: Location[];
  suppressions?: Suppression[];
}

interface Notification {
  level: 'error';
  message: { text: string };
  locations: Location[];
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: { driver: { name: string; informationUri: string; rules: ReportingDescriptor[] } };
    originalUriBaseIds?: Record<string, { uri: string }>;
    artifacts: { location: ArtifactLocation }[];
    results: Result[];
    invocations: { executionSuccessful: boolean; toolConfigurationNotifications: Notification[] }[];
  }[];
}

/** The SARIF tags for one rule's docs, or an empty list when it carries no ids. */
export function taxonomyTags(docs: unknown): string[] {
  if (typeof docs !== 'object' || docs === null) {
    return [];
  }
  const { cwe, owasp } = docs as RuleDocs;
  const tags: string[] = [];
  for (const id of Array.isArray(cwe) ? cwe : []) {
    const match = /^CWE-(\d+)$/iu.exec(String(id));
    if (match?.[1] !== undefined) {
      tags.push(`external/cwe/cwe-${match[1].padStart(3, '0')}`);
    }
  }
  for (const id of Array.isArray(owasp) ? owasp : []) {
    tags.push(`external/owasp/${String(id).toLowerCase()}`);
  }
  return tags.length === 0 ? tags : ['security', ...tags];
}

/** The `security-severity` string for a docs object, or undefined when it has no valid score. */
export function securitySeverity(docs: unknown): string | undefined {
  if (typeof docs !== 'object' || docs === null) {
    return undefined;
  }
  const score = (docs as RuleDocs).securitySeverity;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10) {
    return undefined;
  }
  return score.toFixed(1);
}

/** Forward slashes, no trailing slash (a root keeps its slash). */
function normalisePath(path: string): string {
  const forward = path.replace(/\\/gu, '/');
  return forward.length > 1 && forward.endsWith('/') && !/^[A-Za-z]:\/$/u.test(forward)
    ? forward.slice(0, -1)
    : forward;
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\//u.test(path) || path.startsWith('//');
}

function encodeSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/u.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
}

/** An absolute path (POSIX, `C:\...` or a UNC `\\server\share`) as a file URI. */
export function toFileUri(path: string, directory = false): string {
  const normalised = normalisePath(path);
  const withSlash = directory && !normalised.endsWith('/') ? `${normalised}/` : normalised;
  if (withSlash.startsWith('//')) {
    return `file:${encodeSegments(withSlash)}`;
  }
  if (/^[A-Za-z]:\//u.test(withSlash)) {
    return `file:///${encodeSegments(withSlash)}`;
  }
  return `file://${encodeSegments(withSlash)}`;
}

/**
 * The artifact location of `filePath`: relative to `cwd` under `SRCROOT` when
 * the file is inside it and `absoluteUris` is off, else an absolute file URI.
 */
export function artifactLocation(filePath: string, cwd: string, absoluteUris: boolean): ArtifactLocation {
  const file = normalisePath(filePath);
  if (!absoluteUris) {
    const root = normalisePath(cwd);
    // Windows paths compare without case, as the file system does.
    const fold = (value: string): string => (isWindowsPath(root) ? value.toLowerCase() : value);
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (fold(file).startsWith(fold(prefix))) {
      return { uri: encodeSegments(file.slice(prefix.length)), uriBaseId: SRCROOT };
    }
    if (!file.startsWith('/') && !isWindowsPath(file) && !file.startsWith('<')) {
      // Already relative (`lintText` without a path keeps `<text>`).
      return { uri: encodeSegments(file.replace(/^\.\//u, '')), uriBaseId: SRCROOT };
    }
  }
  if (file.startsWith('<')) {
    return { uri: encodeURIComponent(file) };
  }
  return { uri: toFileUri(file) };
}

function region(message: Linter.LintMessage): Region | undefined {
  if (!Number.isInteger(message.line) || message.line < 1) {
    return undefined;
  }
  const result: Region = { startLine: message.line };
  if (Number.isInteger(message.column) && message.column >= 1) {
    result.startColumn = message.column;
  }
  if (message.endLine !== undefined && Number.isInteger(message.endLine) && message.endLine >= message.line) {
    result.endLine = message.endLine;
    if (message.endColumn !== undefined && Number.isInteger(message.endColumn) && message.endColumn >= 1) {
      result.endColumn = message.endColumn;
    }
  }
  return result;
}

function suppressionsOf(message: Linter.SuppressedLintMessage): Suppression[] {
  const list = Array.isArray(message.suppressions) ? message.suppressions : [];
  const mapped = list.map((entry): Suppression => {
    const suppression: Suppression = { kind: entry.kind === 'directive' ? 'inSource' : 'external' };
    const justification = typeof entry.justification === 'string' ? entry.justification.trim() : '';
    if (justification.length > 0) {
      suppression.justification = justification;
    }
    return suppression;
  });
  return mapped.length > 0 ? mapped : [{ kind: 'inSource' }];
}

/** Builds the SARIF 2.1.0 log for ESLint results. */
export function buildSarifLog(
  results: readonly ESLint.LintResult[],
  data?: Partial<ESLint.LintResultData> | null,
  options: SarifOptions = {},
): SarifLog {
  const cwd = options.cwd ?? data?.cwd ?? process.cwd();
  const absoluteUris = options.absoluteUris === true;
  const rulesMeta: RulesMeta = data?.rulesMeta ?? {};

  const rules: ReportingDescriptor[] = [];
  const ruleIndex = new Map<string, number>();
  const artifacts: { location: ArtifactLocation }[] = [];
  const artifactIndex = new Map<string, number>();
  const sarifResults: Result[] = [];
  const notifications: Notification[] = [];

  const indexRule = (id: string): number => {
    const known = ruleIndex.get(id);
    if (known !== undefined) {
      return known;
    }
    const docs = rulesMeta[id]?.docs as RuleDocs | undefined;
    const descriptor: ReportingDescriptor = { id };
    if (typeof docs?.description === 'string' && docs.description.length > 0) {
      descriptor.shortDescription = { text: docs.description };
    }
    if (typeof docs?.url === 'string' && /^https?:\/\//u.test(docs.url)) {
      descriptor.helpUri = docs.url;
    }
    const properties: Record<string, unknown> = {};
    if (typeof docs?.category === 'string') {
      properties.category = docs.category;
    }
    const tags = taxonomyTags(docs);
    if (tags.length > 0) {
      properties.tags = tags;
    }
    const severity = securitySeverity(docs);
    if (severity !== undefined) {
      properties['security-severity'] = severity;
    }
    if (Object.keys(properties).length > 0) {
      descriptor.properties = properties;
    }
    rules.push(descriptor);
    ruleIndex.set(id, rules.length - 1);
    return rules.length - 1;
  };

  const locate = (filePath: string, message: Linter.LintMessage): Location => {
    const location = artifactLocation(filePath, cwd, absoluteUris);
    const key = `${location.uriBaseId ?? ''}|${location.uri}`;
    let index = artifactIndex.get(key);
    if (index === undefined) {
      artifacts.push({ location: { ...location } });
      index = artifacts.length - 1;
      artifactIndex.set(key, index);
    }
    const physicalLocation: Location['physicalLocation'] = { artifactLocation: { ...location, index } };
    const span = region(message);
    if (span !== undefined) {
      physicalLocation.region = span;
    }
    return { physicalLocation };
  };

  const toResult = (filePath: string, message: Linter.LintMessage): Result => {
    const result: Result = {
      level: message.severity === 2 ? 'error' : 'warning',
      message: { text: message.message },
      locations: [locate(filePath, message)],
    };
    if (typeof message.ruleId === 'string' && message.ruleId.length > 0) {
      result.ruleId = message.ruleId;
      result.ruleIndex = indexRule(message.ruleId);
    }
    return result;
  };

  for (const lintResult of results) {
    for (const message of lintResult.messages) {
      if (message.fatal === true) {
        notifications.push({
          level: 'error',
          message: { text: message.message },
          locations: [locate(lintResult.filePath, message)],
        });
        continue;
      }
      sarifResults.push(toResult(lintResult.filePath, message));
    }
    for (const message of lintResult.suppressedMessages ?? []) {
      sarifResults.push({ ...toResult(lintResult.filePath, message), suppressions: suppressionsOf(message) });
    }
  }

  const run: SarifLog['runs'][number] = {
    tool: { driver: { name: 'ESLint', informationUri: 'https://eslint.org', rules } },
    artifacts,
    results: sarifResults,
    invocations: [{ executionSuccessful: notifications.length === 0, toolConfigurationNotifications: notifications }],
  };
  if (!absoluteUris) {
    run.originalUriBaseIds = { [SRCROOT]: { uri: toFileUri(cwd, true) } };
  }
  return { $schema: SARIF_SCHEMA_URI, version: '2.1.0', runs: [run] };
}
