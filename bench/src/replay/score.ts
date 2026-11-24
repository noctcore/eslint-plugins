/**
 * Lints each advisory's files before and after the fix and classifies them.
 *
 * The rules are the ones the corpus measures for the advisory's CWE: the
 * category whose `category.json` names that CWE, linted with the same flat
 * config (`recommended` plus the category's overrides) the corpus uses, with
 * inline config comments in the fetched code ignored (a `/* eslint-disable *\/`
 * there must not hide a report). An entry may narrow the rules to the ones
 * that model its sink (`rules`). Per advisory and per rule:
 *
 *   before  TP when the rule reports near the fix in a vulnerable file, FN otherwise;
 *   after   FP when the rule reports near the fix in a fixed file, TN otherwise.
 *
 * "Near the fix" is {@link nearTouched}: in the function the fix changed, or
 * inside the manifest's line ranges on the before side when it gives any.
 * Reports elsewhere in the file are kept in the results, marked unrelated.
 *
 * A file that could not be fetched or parsed on either side leaves the
 * advisory without an outcome: it is listed, never counted. Linting is
 * `Linter#verify` on a string: the fetched code is parsed, never loaded,
 * imported or run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Linter } from 'eslint';

import type { Category } from '../corpus';
import { categoryConfig, eslintRuleId, type LoadedPlugin, type Outcome } from '../score';
import { cachePath, SIDES, type Side } from './fetch';
import { functionSpans, nearTouched, touchedLines } from './locate';
import type { ManifestEntry, ScopeReason } from './manifest';

export interface ReplayReport {
  readonly rule: string;
  readonly side: Side;
  readonly path: string;
  readonly line: number;
  readonly message: string;
  /** Whether it is near the fix (see the module comment); only these count. */
  readonly related: boolean;
}

export interface ReplayProblem {
  readonly side: Side;
  readonly path: string;
  readonly kind: 'unavailable' | 'unparsed';
  readonly detail: string;
}

export interface RuleOutcome {
  /** TP or FN, null when the before side could not be linted. */
  readonly before: Outcome | null;
  /** FP or TN, null when the after side could not be linted. */
  readonly after: Outcome | null;
}

export interface ReplayResult {
  readonly id: string;
  readonly package: string;
  readonly repo: string;
  readonly cwe: string;
  readonly category: string;
  readonly scope: 'in' | 'out';
  readonly scopeReason: ScopeReason | null;
  readonly note: string;
  readonly files: readonly string[];
  readonly rules: Readonly<Record<string, RuleOutcome>>;
  readonly reports: readonly ReplayReport[];
  readonly problems: readonly ReplayProblem[];
}

/** The corpus category that measures a CWE. Exactly one per replayed CWE. */
export function categoryForCwe(categories: readonly Category[], cwe: string): Category {
  const matches = categories.filter((c) => c.plugin === 'security' && c.config.cwe === cwe);
  if (matches.length !== 1) {
    throw new Error(`expected one security corpus category for ${cwe}, found ${matches.length}`);
  }
  return matches[0] as Category;
}

/** The name ESLint sees: the real path under a virtual root, `.mts` / `.cts` linted as `.ts`. */
function virtualName(cwd: string, entry: ManifestEntry, side: Side, path: string): string {
  return join(cwd, 'replay', entry.id, side, path.replace(/\.[mc]ts$/u, '.ts'));
}

/** The category's flat config, with the fetched code's own inline config comments switched off. */
function replayConfig(category: Category, plugin: LoadedPlugin): Linter.Config[] {
  return [...categoryConfig(category, plugin), { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' } }];
}

/** Lints and classifies one advisory from the files in `cacheRoot`. */
export function replayEntry(
  entry: ManifestEntry,
  category: Category,
  plugin: LoadedPlugin,
  cacheRoot: string,
  linter: Linter,
  cwd: string,
): ReplayResult {
  const config = replayConfig(category, plugin);
  const rules = entry.rules ?? category.config.rules;
  const reports: ReplayReport[] = [];
  const problems: ReplayProblem[] = [];
  for (const file of entry.files) {
    const sources = new Map<Side, string>();
    for (const side of SIDES) {
      const path = cachePath(cacheRoot, entry.id, side, file.path);
      if (existsSync(path)) sources.set(side, readFileSync(path, 'utf8'));
      else problems.push({ side, path: file.path, kind: 'unavailable', detail: 'not in the fetch cache' });
    }
    const before = sources.get('before');
    const after = sources.get('after');
    if (before === undefined || after === undefined) continue;
    const touched = touchedLines(before, after);
    for (const side of SIDES) {
      const source = side === 'before' ? before : after;
      const filename = virtualName(cwd, entry, side, file.path);
      const messages = linter.verify(source, config, { filename });
      const fatal = messages.find((m) => m.fatal === true);
      if (fatal !== undefined) {
        problems.push({ side, path: file.path, kind: 'unparsed', detail: `${fatal.line}: ${fatal.message}` });
        continue;
      }
      const spans = functionSpans(source, filename);
      const changed = side === 'before' ? touched.before : touched.after;
      for (const rule of rules) {
        for (const m of messages.filter((message) => message.ruleId === eslintRuleId(rule))) {
          const ranges = side === 'before' ? file.lines : undefined;
          const related =
            ranges === undefined
              ? nearTouched(m.line, spans, changed)
              : ranges.some(([from, to]) => m.line >= from && m.line <= to);
          reports.push({ rule, side, path: file.path, line: m.line, message: m.message, related });
        }
      }
    }
  }
  const broken = problems.length > 0;
  const outcomes: Record<string, RuleOutcome> = {};
  for (const rule of rules) {
    const hit = (side: Side): boolean => reports.some((r) => r.rule === rule && r.side === side && r.related);
    outcomes[rule] = {
      before: broken ? null : hit('before') ? 'TP' : 'FN',
      after: broken ? null : hit('after') ? 'FP' : 'TN',
    };
  }
  return {
    id: entry.id,
    package: entry.package,
    repo: entry.repo,
    cwe: entry.cwe,
    category: category.id,
    scope: entry.scope,
    scopeReason: entry.scopeReason ?? null,
    note: entry.note,
    files: entry.files.map((f) => f.path),
    rules: outcomes,
    reports,
    problems,
  };
}

/** Lints every entry; the category of each comes from its CWE. */
export function replayManifest(
  entries: readonly ManifestEntry[],
  categories: readonly Category[],
  plugin: LoadedPlugin,
  cacheRoot: string,
  cwd: string,
): ReplayResult[] {
  const linter = new Linter({ cwd });
  return entries.map((entry) => {
    const category = categoryForCwe(categories, entry.cwe);
    const foreign = (entry.rules ?? []).filter((rule) => !category.config.rules.includes(rule));
    if (foreign.length > 0) throw new Error(`${entry.id}: ${foreign.join(', ')} not measured by ${category.id}`);
    return replayEntry(entry, category, plugin, cacheRoot, linter, cwd);
  });
}
