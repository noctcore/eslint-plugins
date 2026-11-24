/**
 * Summarises an advisory replay, renders it as Markdown, and holds it to a
 * committed baseline (`bench/advisories/baseline.json`).
 *
 * Rates count in-scope advisories only. Out-of-scope advisories are linted
 * all the same and get their own columns, so a rule that catches one anyway
 * shows, and the tagging cannot hide anything: the case is still listed.
 */
import { percent, scoreOf, signedPercent, type Score } from '../metrics';
import type { Outcome } from '../score';
import { SCOPE_REASONS, type ScopeReason } from './manifest';
import type { ReplayResult, RuleOutcome } from './score';

export interface ReplayRow extends Score {
  /** Advisories in this row, in and out of scope. */
  readonly advisories: number;
  readonly outOfScope: number;
  /** Out-of-scope advisories whose vulnerable code was reported anyway. */
  readonly outOfScopeDetected: number;
  /** Out-of-scope advisories whose fixed code was reported. */
  readonly outOfScopeFalseAlarms: number;
  /** In-scope advisories with a side that could not be fetched or parsed. */
  readonly unavailable: number;
}

export interface ReplaySummary {
  readonly advisories: number;
  readonly inScope: number;
  readonly outOfScope: Readonly<Record<string, number>>;
  readonly total: ReplayRow;
  readonly cwes: Readonly<Record<string, ReplayRow>>;
  readonly rules: Readonly<Record<string, ReplayRow>>;
}

/** One rule's or one CWE's verdict on one advisory. */
interface Verdict {
  readonly result: ReplayResult;
  readonly outcome: RuleOutcome;
}

/** A CWE's verdict: any of the category's rules reporting counts. */
function anyRule(result: ReplayResult): RuleOutcome {
  const outcomes = Object.values(result.rules);
  const side = (pick: (o: RuleOutcome) => Outcome | null, hit: Outcome, miss: Outcome): Outcome | null =>
    outcomes.some((o) => pick(o) === null) ? null : outcomes.some((o) => pick(o) === hit) ? hit : miss;
  return { before: side((o) => o.before, 'TP', 'FN'), after: side((o) => o.after, 'FP', 'TN') };
}

function row(verdicts: readonly Verdict[]): ReplayRow {
  const inScope = verdicts.filter((v) => v.result.scope === 'in');
  const out = verdicts.filter((v) => v.result.scope === 'out');
  const outcomes = inScope.flatMap((v) => [v.outcome.before, v.outcome.after]).filter((o): o is Outcome => o !== null);
  return {
    ...scoreOf(outcomes.map((outcome) => ({ outcome }))),
    advisories: verdicts.length,
    outOfScope: out.length,
    outOfScopeDetected: out.filter((v) => v.outcome.before === 'TP').length,
    outOfScopeFalseAlarms: out.filter((v) => v.outcome.after === 'FP').length,
    unavailable: inScope.filter((v) => v.outcome.before === null || v.outcome.after === null).length,
  };
}

function grouped(verdicts: readonly (Verdict & { readonly key: string })[]): Record<string, ReplayRow> {
  const keys = [...new Set(verdicts.map((v) => v.key))].sort();
  return Object.fromEntries(keys.map((key) => [key, row(verdicts.filter((v) => v.key === key))]));
}

export function summarize(results: readonly ReplayResult[]): ReplaySummary {
  const perCwe = results.map((result) => ({ result, outcome: anyRule(result), key: result.cwe }));
  const perRule = results.flatMap((result) =>
    Object.entries(result.rules).map(([rule, outcome]) => ({ result, outcome, key: rule })),
  );
  const outOfScope: Record<string, number> = {};
  for (const r of results) {
    if (r.scopeReason !== null) outOfScope[r.scopeReason] = (outOfScope[r.scopeReason] ?? 0) + 1;
  }
  return {
    advisories: results.length,
    inScope: results.filter((r) => r.scope === 'in').length,
    outOfScope,
    total: row(perCwe),
    cwes: grouped(perCwe),
    rules: grouped(perRule),
  };
}

// The committed baseline ------------------------------------------------------

export interface ReplayBaseline {
  readonly plugin: string;
  /** `<GHSA>#<rule>`: the outcome of each side. */
  readonly outcomes: Readonly<Record<string, RuleOutcome>>;
  readonly summary: ReplaySummary;
}

export interface ReplayChange {
  readonly id: string;
  readonly side: 'before' | 'after';
  readonly from: Outcome | null;
  readonly to: Outcome | null;
}

export interface ReplayComparison {
  /** TP to FN (stopped catching a real advisory) or TN to FP (started reporting its fix). */
  readonly regressions: readonly ReplayChange[];
  readonly improvements: readonly ReplayChange[];
  /** A side recorded in the baseline that could not be linted this run: not a regression, not forgotten. */
  readonly unavailable: readonly ReplayChange[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly upToDate: boolean;
}

/**
 * The outcomes to record: this run's, except that a side this run could not
 * lint keeps its committed value, so a flaky fetch never erases a result.
 */
export function buildReplayBaseline(
  plugin: string,
  results: readonly ReplayResult[],
  committed: ReplayBaseline | null,
): ReplayBaseline {
  const outcomes: Record<string, RuleOutcome> = {};
  for (const result of results) {
    for (const [rule, outcome] of Object.entries(result.rules)) {
      const id = `${result.id}#${rule}`;
      const previous = committed?.outcomes[id];
      outcomes[id] = {
        before: outcome.before ?? previous?.before ?? null,
        after: outcome.after ?? previous?.after ?? null,
      };
    }
  }
  const sorted = Object.fromEntries(Object.entries(outcomes).sort(([a], [b]) => a.localeCompare(b)));
  return { plugin, outcomes: sorted, summary: summarize(results) };
}

const WORSE: Readonly<Record<string, Outcome>> = { TP: 'FN', TN: 'FP' };

export function compareReplay(committed: ReplayBaseline | null, results: readonly ReplayResult[]): ReplayComparison {
  const current = new Map<string, RuleOutcome>(
    results.flatMap((r) => Object.entries(r.rules).map(([rule, o]) => [`${r.id}#${rule}`, o] as const)),
  );
  const before = committed?.outcomes ?? {};
  const regressions: ReplayChange[] = [];
  const improvements: ReplayChange[] = [];
  const unavailable: ReplayChange[] = [];
  for (const [id, now] of current) {
    const was = before[id];
    if (was === undefined) continue;
    for (const side of ['before', 'after'] as const) {
      const from = was[side];
      const to = now[side];
      if (from === to) continue;
      const change = { id, side, from, to };
      if (to === null) unavailable.push(change);
      else if (from !== null && WORSE[from] === to) regressions.push(change);
      else improvements.push(change);
    }
  }
  const added = [...current.keys()].filter((id) => before[id] === undefined);
  const removed = Object.keys(before).filter((id) => !current.has(id));
  return {
    regressions,
    improvements,
    unavailable,
    added,
    removed,
    upToDate: committed !== null && regressions.length + improvements.length + added.length + removed.length === 0,
  };
}

// Markdown ----------------------------------------------------------------------

const HEAD = '| Advisories | Out of scope | Unavailable | Detected | Missed | False alarms | Clean after | Detection | False-alarm rate | J | Out of scope: detected / false alarms |';
const RULE = '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';

function cells(r: ReplayRow): string {
  return `${r.advisories} | ${r.outOfScope} | ${r.unavailable} | ${r.tp} | ${r.fn} | ${r.fp} | ${r.tn} | ${percent(r.detection)} | ${percent(r.falseAlarm)} | ${signedPercent(r.j)} | ${r.outOfScopeDetected} / ${r.outOfScopeFalseAlarms} |`;
}

function where(result: ReplayResult, path: string, line?: number): string {
  return `${result.repo}/${path}${line === undefined ? '' : `:${line}`}`;
}

export function renderReplayMarkdown(
  results: readonly ReplayResult[],
  summary: ReplaySummary,
  comparison: ReplayComparison | null,
  pluginVersion: string,
): string {
  const lines: string[] = ['# Advisory replay', ''];
  lines.push(
    `${summary.advisories} published npm advisories, linted at the commit before the fix and at the fix with \`@noctcore/eslint-plugin-security\` ${pluginVersion}, using the corpus category's rules for each CWE. **Detected**: a rule reports the vulnerable file. **False alarms**: a rule still reports the fixed file. Rates count the ${summary.inScope} in-scope advisories; out-of-scope ones (the rules cannot see them in principle) are linted too and shown in the last column.`,
    '',
    '## Per CWE',
    '',
    `| CWE ${HEAD}`,
    `| --- ${RULE}`,
  );
  for (const [cwe, r] of Object.entries(summary.cwes)) lines.push(`| ${cwe} | ${cells(r)}`);
  lines.push(`| **all** | ${cells(summary.total)}`);
  lines.push('', '## Per rule', '', `| Rule ${HEAD}`, `| --- ${RULE}`);
  for (const [rule, r] of Object.entries(summary.rules)) lines.push(`| \`${rule}\` | ${cells(r)}`);

  lines.push('', '## Out of scope', '', '| Reason | Advisories | Meaning |', '| --- | ---: | --- |');
  for (const [reason, meaning] of Object.entries(SCOPE_REASONS)) {
    lines.push(`| ${reason} | ${summary.outOfScope[reason] ?? 0} | ${meaning} |`);
  }

  const inScope = results.filter((r) => r.scope === 'in');
  const misses = inScope.flatMap((r) =>
    Object.entries(r.rules)
      .filter(([, o]) => o.before === 'FN')
      .map(([rule]) => `- \`${rule}\` missed ${r.id} (${r.package}, ${r.cwe}): ${r.files.map((f) => where(r, f)).join(', ')}. ${r.note}`),
  );
  lines.push('', `## Missed advisories, in scope (${misses.length})`, '', ...misses);

  const alarms = inScope.flatMap((r) =>
    r.reports
      .filter((rep) => rep.side === 'after' && rep.related)
      .map((rep) => `- \`${rep.rule}\` on ${r.id} (${r.package}) after the fix: ${where(r, rep.path, rep.line)}: ${rep.message}`),
  );
  lines.push('', `## False alarms on fixed code, in scope (${alarms.length} reports)`, '', ...alarms);

  const caught = inScope.flatMap((r) =>
    r.reports
      .filter((rep) => rep.side === 'before' && rep.related)
      .map((rep) => `- \`${rep.rule}\` on ${r.id} (${r.package}): ${where(r, rep.path, rep.line)}`),
  );
  lines.push('', `## Detections on vulnerable code, in scope (${caught.length} reports)`, '', ...caught);

  const out = results.filter((r) => r.scope === 'out');
  lines.push('', `## Out-of-scope advisories (${out.length})`, '');
  for (const r of out) {
    const verdict = anyRule(r);
    lines.push(`- ${r.id} (${r.package}, ${r.cwe}) ${r.scopeReason as ScopeReason}: ${r.note} Before: ${verdict.before ?? 'n/a'}, after: ${verdict.after ?? 'n/a'}.`);
  }

  const problems = results.flatMap((r) => r.problems.map((p) => `- ${r.id} ${p.side} ${p.path}: ${p.kind} (${p.detail})`));
  if (problems.length > 0) lines.push('', `## Not linted (${problems.length})`, '', ...problems);

  if (comparison !== null) {
    const list = (label: string, changes: readonly ReplayChange[]): void => {
      lines.push(`- ${label}: ${changes.length}`);
      for (const c of changes) lines.push(`  - \`${c.id}\` ${c.side}: ${c.from ?? 'n/a'} -> ${c.to ?? 'n/a'}`);
    };
    lines.push('', '## Against the committed replay baseline', '');
    list('Regressions', comparison.regressions);
    list('Improvements', comparison.improvements);
    list('Could not be linted this run', comparison.unavailable);
    lines.push(`- New: ${comparison.added.length}`, `- Removed: ${comparison.removed.length}`);
    lines.push(`- Baseline up to date: ${comparison.upToDate ? 'yes' : 'no'}`);
  }
  return `${lines.join('\n')}\n`;
}
