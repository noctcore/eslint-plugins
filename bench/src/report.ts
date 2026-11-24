/**
 * Renders the scores as Markdown (the console table, `out/report.md` and the CI
 * job summary) and as SARIF 2.1.0 (`out/bench.sarif`).
 */
import { variantFlip, type Baseline, type Comparison } from './baseline';
import { percent, signedPercent, type Score } from './metrics';
import type { Report } from './score';
import { MIN_VARIANTS_PER_CASE, TRANSFORMS, splitVariantFile } from './variants/generate';

function scoreCells(score: Score & { readonly extra: number }): string {
  return `${score.tp} | ${score.fn} | ${score.fp} | ${score.tn} | ${score.extra} | ${percent(score.detection)} | ${percent(score.falseAlarm)} | ${signedPercent(score.j)}`;
}

const SCORE_HEAD = 'TP | FN | FP | TN | Extra | Detection | False alarms | J';
const SCORE_RULE = '---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:';

/** Lists longer than this stop with a count; regressions are always listed in full. */
const LIST_LIMIT = 50;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function renderVariants(baseline: Baseline, counts: ReadonlyMap<string, number> | null): string[] {
  const variantCount = Object.keys(baseline.variants).length;
  if (variantCount === 0 && counts === null) return [];
  const lines: string[] = ['', '## Variants', ''];
  lines.push(
    'Each variant rewrites one corpus case without changing what the code does (a renamed local, an aliased import, the value passed through a helper, a template literal written as concatenation, and so on). A rule should give a variant the same verdict as its case. **Missed**: the case is caught, the variant is not. **False alarms**: the case is left alone, the variant is reported. **Gained**: the case is a known gap and the variant is not, so the verdict still hangs on the shape.',
    '',
  );
  if (counts !== null) {
    const perCase = [...counts.values()];
    const total = perCase.reduce((a, b) => a + b, 0);
    lines.push(
      `${total} variants of ${perCase.length} cases: at least ${Math.min(...perCase)}, median ${median(perCase)}, at most ${Math.max(...perCase)} per case.`,
    );
    const short = [...counts].filter(([, n]) => n < MIN_VARIANTS_PER_CASE);
    if (short.length > 0) {
      lines.push('', `Cases with fewer than ${MIN_VARIANTS_PER_CASE} variants (the other transforms do not apply to their shape):`, '');
      for (const [file, n] of short) lines.push(`- \`${file}\`: ${n}`);
    }
    lines.push('');
  }
  const order = new Map(TRANSFORMS.map((t, i) => [t.name, i]));
  const byOrder = (a: string, b: string): number => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  lines.push('### Per rule', '', '| Rule | TP | FN | FP | TN | Detection | False alarms | J | Invariant to | Fails on |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const [rule, score] of Object.entries(baseline.variantRules)) {
    const entries = Object.entries(score.transforms).sort(([a], [b]) => byOrder(a, b));
    const invariant = entries.filter(([, t]) => t.holds === t.variants).map(([name]) => name);
    const fails = entries
      .filter(([, t]) => t.missed + t.falseAlarms > 0)
      .map(([name, t]) => `${name} (${[t.missed > 0 ? `${t.missed} missed` : '', t.falseAlarms > 0 ? `${t.falseAlarms} false alarm${t.falseAlarms === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})`);
    lines.push(
      `| \`${rule}\` | ${score.tp} | ${score.fn} | ${score.fp} | ${score.tn} | ${percent(score.detection)} | ${percent(score.falseAlarm)} | ${signedPercent(score.j)} | ${invariant.join(', ') || '-'} | ${fails.join(', ') || '-'} |`,
    );
  }
  lines.push('', '### Per rule and transform', '', '| Rule | Transform | Variants | Holds | Missed | False alarms | Gained |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [rule, score] of Object.entries(baseline.variantRules)) {
    for (const [name, t] of Object.entries(score.transforms).sort(([a], [b]) => byOrder(a, b))) {
      lines.push(`| \`${rule}\` | ${name} | ${t.variants} | ${t.holds} | ${t.missed} | ${t.falseAlarms} | ${t.gained} |`);
    }
  }
  const flips = Object.entries(baseline.variants)
    .map(([id, outcome]) => {
      const at = id.indexOf('#');
      const split = splitVariantFile(id.slice(0, at));
      const baseId = split === null ? id : `${split.baseFile}${id.slice(at)}`;
      const base = baseline.cases[baseId];
      return { id, outcome, base, flip: base === undefined ? 'holds' : variantFlip(base.outcome, outcome) };
    })
    .filter((f) => f.flip === 'missed' || f.flip === 'falseAlarms');
  lines.push('', `### Variants that flip a caught or clean case (${flips.length})`, '');
  lines.push('Promote one to a committed case with `bun run bench --promote <file>~<transform>`.', '');
  for (const f of flips) {
    lines.push(`- ${f.flip === 'missed' ? 'missed' : 'false alarm'} \`${f.id}\`: ${f.base?.title ?? ''}`);
  }
  return lines;
}

export function renderMarkdown(
  baseline: Baseline,
  comparison: Comparison | null,
  variantCounts: ReadonlyMap<string, number> | null = null,
): string {
  const lines: string[] = ['# Bench report', ''];
  lines.push('## Per rule', '', `| Rule | Enabled by | ${SCORE_HEAD} | Other categories' safe cases reported |`, `| --- | --- | ${SCORE_RULE} | ---: |`);
  for (const [rule, score] of Object.entries(baseline.rules)) {
    lines.push(`| \`${rule}\` | ${score.enabledBy} | ${scoreCells(score)} | ${score.crossFp} of ${score.crossSafe} |`);
  }
  lines.push('', '## Per category', '', `| Category | CWE | Pairs | ${SCORE_HEAD} |`, `| --- | --- | ---: | ${SCORE_RULE} |`);
  for (const [id, category] of Object.entries(baseline.categories)) {
    lines.push(`| ${id} | ${category.cwe ?? '-'} | ${category.pairs} | ${scoreCells(category)} |`);
  }

  const gaps = Object.entries(baseline.cases).filter(([, c]) => c.outcome === 'FN' || c.outcome === 'FP');
  lines.push('', `## Known gaps (${gaps.length})`, '');
  lines.push('FN: a vulnerable case the rule misses. FP: a safe case the rule reports. Extra (in the tables): a report on an unlabelled line of a vulnerable case.', '');
  for (const [id, c] of gaps) {
    lines.push(`- ${c.outcome} \`${id}\`: ${c.title}`);
  }

  lines.push(...renderVariants(baseline, variantCounts));

  if (comparison !== null) {
    lines.push('', '## Against the committed baseline', '');
    const list = (label: string, changes: Comparison['regressions'], limit = LIST_LIMIT): void => {
      lines.push(`- ${label}: ${changes.length}`);
      for (const change of changes.slice(0, limit)) {
        lines.push(`  - \`${change.id}\` ${change.from ?? 'new'} -> ${change.to ?? 'removed'}`);
      }
      if (changes.length > limit) lines.push(`  - ... and ${changes.length - limit} more`);
    };
    list('Regressions', comparison.regressions, Infinity);
    list('Improvements', comparison.improvements);
    list('New cases', comparison.added);
    list('Removed cases', comparison.removed);
    lines.push(`- Baseline file up to date: ${comparison.upToDate ? 'yes' : 'no'}`);
  }
  return `${lines.join('\n')}\n`;
}

/** SARIF 2.1.0: one result per ESLint report, tagged with how the bench counted it. */
export function renderSarif(baseline: Baseline, reports: readonly Report[]): string {
  const ruleIds = [...new Set(reports.map((r) => r.ruleId))].sort();
  const rules = ruleIds.map((id) => {
    const benchId = id.startsWith('noctcore-') ? id.slice('noctcore-'.length) : id;
    const measured = baseline.rules[benchId];
    return {
      id,
      ...(measured?.description ? { shortDescription: { text: measured.description } } : {}),
      ...(measured?.url ? { helpUri: measured.url } : {}),
    };
  });
  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'noctcore-bench',
            informationUri: 'https://github.com/noctcore/eslint-plugins/tree/main/bench',
            rules,
          },
        },
        results: reports.map((r) => ({
          ruleId: r.ruleId,
          ruleIndex: ruleIds.indexOf(r.ruleId),
          level: 'error',
          message: { text: r.message },
          locations: [
            {
              physicalLocation: {
                // Relative to the repository root, as code-scanning tools expect.
                artifactLocation: { uri: `bench/corpus/${r.file}` },
                region: { startLine: r.line, startColumn: r.column, endLine: r.endLine, endColumn: r.endColumn },
              },
            },
          ],
          properties: { benchRole: r.role },
        })),
        properties: { rules: baseline.rules, categories: baseline.categories },
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
