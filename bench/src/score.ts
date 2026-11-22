/**
 * Runs ESLint over the corpus and classifies every label.
 *
 * Each category is linted with its plugin's `recommended` preset plus the
 * category's own `overrides`. Then:
 *
 * - every `// expect:` label is a positive: TP when its rule reports a
 *   problem that starts on the labelled line, FN otherwise;
 * - every safe case is one negative for each measured rule that runs on it
 *   (the rules any category of the plugin measures, when the preset or this
 *   category's overrides turn them on): FP when that rule reports anything in
 *   the file, TN otherwise. So a rule is also charged for firing on another
 *   category's safe code;
 * - a measured rule's report in a vuln case that no label explains is an
 *   "extra" (often a real false alarm on the guard-free code around the sink),
 *   counted in its own column; any other rule's report is "stray". Neither
 *   moves the four counts.
 */
import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';

import type { Category, CorpusCase, RuleEntry } from './corpus';

export type Outcome = 'TP' | 'FN' | 'FP' | 'TN';

export interface CaseResult {
  /** Stable id: `<file>#<rule>`, with `#<n>` from the second label of one rule in one file. */
  readonly id: string;
  readonly category: string;
  readonly rule: string;
  readonly outcome: Outcome;
  readonly file: string;
  /** The labelled line for a positive, the first report for an FP, else null. */
  readonly line: number | null;
  readonly pair: string;
  readonly framework: string;
  readonly cwe: string | null;
  readonly title: string;
}

export interface Report {
  readonly file: string;
  readonly ruleId: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly message: string;
  /** How this report counted: matched a label, an FP in a safe case, an unlabelled extra, or another rule's stray. */
  readonly role: 'TP' | 'FP' | 'extra' | 'stray';
}

export interface LoadedPlugin {
  readonly short: string;
  readonly packageName: string;
  /** `noctcore-<short>`, the namespace rule ids carry in ESLint. */
  readonly namespace: string;
  readonly plugin: {
    readonly rules: Record<string, { meta?: { docs?: { url?: string; description?: string } } }>;
    readonly configs: Record<string, unknown>;
  };
  /** Rule names (unprefixed) the plugin's `recommended` preset turns on. */
  readonly recommended: ReadonlySet<string>;
}

export interface ScoreRun {
  readonly results: readonly CaseResult[];
  readonly reports: readonly Report[];
}

const FILES = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs', '**/*.ts', '**/*.tsx'];

/** `security/no-shell-interpolation` to `noctcore-security/no-shell-interpolation`. */
export function eslintRuleId(rule: string): string {
  return `noctcore-${rule}`;
}

/** `noctcore-security/no-shell-interpolation` back to `security/no-shell-interpolation`. */
export function benchRuleId(ruleId: string): string {
  return ruleId.startsWith('noctcore-') ? ruleId.slice('noctcore-'.length) : ruleId;
}

/** Imports `@noctcore/eslint-plugin-<short>` as the workspace builds it. */
export async function loadPlugin(short: string): Promise<LoadedPlugin> {
  const packageName = `@noctcore/eslint-plugin-${short}`;
  const module = (await import(packageName)) as { default: LoadedPlugin['plugin'] };
  const plugin = module.default;
  const namespace = `noctcore-${short}`;
  const preset = plugin.configs.recommended as { rules?: Record<string, unknown> } | undefined;
  const recommended = new Set(
    Object.entries(preset?.rules ?? {})
      .filter(([, entry]) => (Array.isArray(entry) ? entry[0] : entry) === 'error')
      .map(([id]) => id.slice(namespace.length + 1)),
  );
  return { short, packageName, namespace, plugin, recommended };
}

/** The flat config a category is linted with. */
export function categoryConfig(category: Category, plugin: LoadedPlugin): Linter.Config[] {
  const overrides: Record<string, RuleEntry> = {};
  for (const [rule, entry] of Object.entries(category.config.overrides)) {
    overrides[eslintRuleId(rule)] = entry;
  }
  return [
    {
      files: FILES,
      languageOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    { files: FILES, ...(plugin.plugin.configs.recommended as Linter.Config) },
    { files: FILES, rules: overrides as Linter.RulesRecord },
  ];
}

/**
 * A report answers a label when it starts on the labelled line. Not "any range
 * covering it": a report on a whole function or statement block would then
 * answer every label inside it.
 */
function startsOn(message: Linter.LintMessage, line: number): boolean {
  return message.line === line;
}

/** Classifies one linted case. Exported for the tests. */
export function classifyCase(
  testCase: CorpusCase,
  category: Category,
  messages: readonly Linter.LintMessage[],
  /** Every rule the plugin's corpus measures; reports from others are stray. */
  measuredRules: readonly string[] = category.config.rules,
  /** The measured rules that run on this category's files: each safe case is a negative for these. */
  negativeRules: readonly string[] = category.config.rules,
): ScoreRun {
  const measured = new Set(measuredRules);
  const base = {
    category: category.id,
    file: testCase.file,
    pair: testCase.meta.pair,
    framework: testCase.meta.framework,
    cwe: testCase.meta.cwe,
    title: testCase.meta.title,
  };
  const results: CaseResult[] = [];
  const matched = new Set<Linter.LintMessage>();

  if (testCase.kind === 'vuln') {
    const seen = new Map<string, number>();
    for (const label of testCase.expects) {
      const n = (seen.get(label.rule) ?? 0) + 1;
      seen.set(label.rule, n);
      const hits = messages.filter((m) => m.ruleId === eslintRuleId(label.rule) && startsOn(m, label.line));
      for (const hit of hits) matched.add(hit);
      results.push({
        ...base,
        id: `${testCase.file}#${label.rule}${n > 1 ? `#${n}` : ''}`,
        rule: label.rule,
        outcome: hits.length > 0 ? 'TP' : 'FN',
        line: label.line,
      });
    }
  } else {
    for (const rule of negativeRules) {
      const hits = messages.filter((m) => m.ruleId === eslintRuleId(rule));
      for (const hit of hits) matched.add(hit);
      results.push({
        ...base,
        id: `${testCase.file}#${rule}`,
        rule,
        outcome: hits.length > 0 ? 'FP' : 'TN',
        line: hits[0]?.line ?? null,
      });
    }
  }

  const reports: Report[] = messages.map((m) => {
    const rule = benchRuleId(m.ruleId ?? '');
    const role: Report['role'] = matched.has(m)
      ? testCase.kind === 'vuln'
        ? 'TP'
        : 'FP'
      : measured.has(rule)
        ? 'extra'
        : 'stray';
    return {
      file: testCase.file,
      ruleId: m.ruleId ?? '',
      line: m.line,
      column: m.column,
      endLine: m.endLine ?? m.line,
      endColumn: m.endColumn ?? m.column,
      message: m.message,
      role,
    };
  });
  return { results, reports };
}

function severityOf(entry: RuleEntry): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

/** Whether a rule is on for a category's files: an override wins, else the preset decides. */
export function runsIn(rule: string, category: Category, plugin: LoadedPlugin): boolean {
  const override = category.config.overrides[rule];
  if (override !== undefined) {
    const severity = severityOf(override);
    return severity !== 'off' && severity !== 0;
  }
  return plugin.recommended.has(rule.slice(category.plugin.length + 1));
}

/** Lints and classifies every case of the given categories. */
export function scoreCategories(
  categories: readonly Category[],
  plugins: ReadonlyMap<string, LoadedPlugin>,
  cwd: string,
): ScoreRun {
  const linter = new Linter({ cwd });
  const results: CaseResult[] = [];
  const reports: Report[] = [];
  const fatal: string[] = [];
  for (const category of categories) {
    const plugin = plugins.get(category.plugin);
    if (plugin === undefined) throw new Error(`no plugin loaded for ${category.id}`);
    for (const rule of [...category.config.rules, ...Object.keys(category.config.overrides)]) {
      const name = rule.slice(category.plugin.length + 1);
      if (!(name in plugin.plugin.rules)) fatal.push(`${category.id}: ${plugin.packageName} has no rule "${name}"`);
    }
    const config = categoryConfig(category, plugin);
    const measuredRules = [
      ...new Set(categories.filter((c) => c.plugin === category.plugin).flatMap((c) => c.config.rules)),
    ].sort();
    const negativeRules = measuredRules.filter((rule) => runsIn(rule, category, plugin));
    for (const testCase of category.cases) {
      const messages = linter.verify(testCase.lintSource, config, { filename: testCase.lintPath });
      const broken = messages.filter((m) => m.fatal === true || m.ruleId === null);
      if (broken.length > 0) {
        fatal.push(...broken.map((m) => `${testCase.file}:${m.line}: ${m.message}`));
        continue;
      }
      const run = classifyCase(testCase, category, messages, measuredRules, negativeRules);
      results.push(...run.results);
      reports.push(...run.reports);
    }
  }
  if (fatal.length > 0) {
    throw new Error(`The corpus did not lint cleanly:\n${fatal.map((f) => `  - ${f}`).join('\n')}`);
  }
  return { results, reports };
}
