/**
 * Renders the scores as Markdown (the console table, `out/report.md` and the CI
 * job summary) and as SARIF 2.1.0 (`out/bench.sarif`).
 */
import type { Baseline, Comparison } from './baseline';
import { percent, signedPercent, type Score } from './metrics';
import type { Report } from './score';

function scoreCells(score: Score): string {
  return `${score.tp} | ${score.fn} | ${score.fp} | ${score.tn} | ${percent(score.detection)} | ${percent(score.falseAlarm)} | ${signedPercent(score.j)}`;
}

const SCORE_HEAD = 'TP | FN | FP | TN | Detection | False alarms | J';
const SCORE_RULE = '---: | ---: | ---: | ---: | ---: | ---: | ---:';

export function renderMarkdown(baseline: Baseline, comparison: Comparison | null): string {
  const lines: string[] = ['# Bench report', ''];
  lines.push('## Per rule', '', `| Rule | Enabled by | ${SCORE_HEAD} |`, `| --- | --- | ${SCORE_RULE} |`);
  for (const [rule, score] of Object.entries(baseline.rules)) {
    lines.push(`| \`${rule}\` | ${score.enabledBy} | ${scoreCells(score)} |`);
  }
  lines.push('', '## Per category', '', `| Category | CWE | Pairs | ${SCORE_HEAD} |`, `| --- | --- | ---: | ${SCORE_RULE} |`);
  for (const [id, category] of Object.entries(baseline.categories)) {
    lines.push(`| ${id} | ${category.cwe ?? '-'} | ${category.pairs} | ${scoreCells(category)} |`);
  }

  const gaps = Object.entries(baseline.cases).filter(([, c]) => c.outcome === 'FN' || c.outcome === 'FP');
  lines.push('', `## Known gaps (${gaps.length})`, '');
  lines.push('FN: a vulnerable case the rule misses. FP: a safe twin the rule reports.', '');
  for (const [id, c] of gaps) {
    lines.push(`- ${c.outcome} \`${id}\`: ${c.title}`);
  }

  if (comparison !== null) {
    lines.push('', '## Against the committed baseline', '');
    const list = (label: string, changes: Comparison['regressions']): void => {
      lines.push(`- ${label}: ${changes.length}`);
      for (const change of changes) {
        lines.push(`  - \`${change.id}\` ${change.from ?? 'new'} -> ${change.to ?? 'removed'}`);
      }
    };
    list('Regressions', comparison.regressions);
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
        originalUriBaseIds: { CORPUS: { uri: 'bench/corpus/' } },
        results: reports.map((r) => ({
          ruleId: r.ruleId,
          ruleIndex: ruleIds.indexOf(r.ruleId),
          level: 'error',
          message: { text: r.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.file, uriBaseId: 'CORPUS' },
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
