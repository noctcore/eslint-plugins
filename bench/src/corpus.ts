/**
 * Reads and validates the labeled corpus.
 *
 * Layout: `corpus/<plugin>/<category>/` holds one `category.json` and one case
 * per file. A case file carries its own answer:
 *
 *   line 1   `// @bench category=<category> cwe=CWE-<n> framework=<f> pair=<id> title="..."`
 *   vuln     `// expect: <plugin>/<rule>` on each line the rule must report
 *   safe     a line that is only `// ok`; nothing in the file may be reported
 *
 * File names are `<pair>.vuln.<ext>.case` and `<pair>.safe[-<n>].<ext>.case`,
 * so every vulnerable case has a safe twin of the same shape that differs by
 * its guard. Labels live in the file, so a case and its answer cannot drift
 * apart. The trailing `.case` keeps code scanners (CodeQL on this public repo)
 * and the repo's own lint from reading deliberately vulnerable samples as
 * source; the scorer lints each one under its virtual `.<ext>` name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type CaseKind = 'vuln' | 'safe';

/** One `// expect: <plugin>/<rule>` label: the rule must report on this 1-based line. */
export interface ExpectLabel {
  readonly rule: string;
  readonly line: number;
}

export interface CaseMeta {
  readonly category: string;
  readonly cwe: string | null;
  readonly framework: string;
  readonly pair: string;
  readonly title: string;
}

export interface CorpusCase {
  /** Path under `corpus/`, always with `/`: `security/ssrf/express-link-preview.vuln.js`. */
  readonly file: string;
  readonly absolutePath: string;
  /** The path the linter sees: {@link absolutePath} without `.case`, so parsers and `files` globs match the language. */
  readonly lintPath: string;
  readonly plugin: string;
  readonly kind: CaseKind;
  readonly meta: CaseMeta;
  readonly expects: readonly ExpectLabel[];
  readonly source: string;
  /** The source as the linter sees it: {@link maskBenchComments}. */
  readonly lintSource: string;
}

/** A rule entry as ESLint takes it: a severity, or `[severity, ...options]`. */
export type RuleEntry = string | readonly unknown[];

export interface CategoryConfig {
  readonly title: string;
  readonly cwe: string | null;
  /** The rules this category measures, as `<plugin>/<rule>`. */
  readonly rules: readonly string[];
  /**
   * Rule entries layered over the plugin's `recommended` preset for this
   * category's files, keyed `<plugin>/<rule>`. This is how an opt-in rule is
   * switched on, and how options a real project would set are recorded.
   */
  readonly overrides: Readonly<Record<string, RuleEntry>>;
}

export interface Category {
  /** `<plugin>/<category>`. */
  readonly id: string;
  readonly plugin: string;
  readonly name: string;
  readonly config: CategoryConfig;
  readonly cases: readonly CorpusCase[];
}

export interface Corpus {
  readonly root: string;
  readonly categories: readonly Category[];
}

const CASE_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(vuln|safe)(?:-(\d+))?\.(js|jsx|ts|tsx|mjs|cjs)\.case$/u;
const HEADER = /^\s*\/\/\s*@bench\s+(.*)$/u;
const HEADER_FIELD = /(\w+)=(?:"([^"]*)"|(\S+))/gu;
const EXPECT = /(?:\/\/|\/\*)\s*expect:\s*([a-z0-9-]+\/[a-z0-9-]+(?:\s*,\s*[a-z0-9-]+\/[a-z0-9-]+)*)/gu;
// A whole label comment: `// expect: ...` to the end of the line, or `/* expect: ... */`.
const EXPECT_COMMENT = /\/\/\s*expect:[^\n]*|\/\*\s*expect:[\s\S]*?\*\//gu;
const OK_LINE = /^\s*(?:\/\/\s*ok|\/\*\s*ok\s*\*\/)\s*$/u;
const CWE = /^CWE-\d+$/u;
const RULE_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/u;

export class CorpusError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The corpus has ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'CorpusError';
  }
}

/** Parses the `@bench` header fields of a case. */
export function parseHeader(line: string): Record<string, string> | null {
  const match = HEADER.exec(line);
  if (match === null) return null;
  const fields: Record<string, string> = {};
  for (const field of (match[1] ?? '').matchAll(HEADER_FIELD)) {
    const key = field[1];
    if (key !== undefined) fields[key] = field[2] ?? field[3] ?? '';
  }
  return fields;
}

/** Every expect label in a source, with its 1-based line. */
export function parseExpects(source: string): ExpectLabel[] {
  const labels: ExpectLabel[] = [];
  source.split(/\r?\n/u).forEach((text, index) => {
    for (const match of text.matchAll(EXPECT)) {
      for (const rule of (match[1] ?? '').split(',')) {
        labels.push({ rule: rule.trim(), line: index + 1 });
      }
    }
  });
  return labels;
}

/**
 * The source with the bench's own comments (the header, `expect:` labels and
 * `// ok`) blanked out by spaces, so lines and columns are unchanged. A rule
 * must never see the answer: `require-path-containment` treats any comment
 * containing `path-containment` as its escape hatch, and the label
 * `// expect: security/require-path-containment` contains exactly that.
 */
export function maskBenchComments(source: string): string {
  return source
    .split(/(\r?\n)/u)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const blank = (text: string): string => ' '.repeat(text.length);
      if (HEADER.test(part) || OK_LINE.test(part)) return blank(part);
      return part.replace(EXPECT_COMMENT, blank);
    })
    .join('');
}

/** Whether a source carries the `// ok` marker of a safe case. */
export function hasOkMarker(source: string): boolean {
  return source.split(/\r?\n/u).some((line) => OK_LINE.test(line));
}

function readCategoryConfig(path: string, id: string, problems: string[]): CategoryConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${id}/category.json: ${(error as Error).message}`);
    return null;
  }
  const value = raw as Partial<Record<keyof CategoryConfig, unknown>>;
  const rules = Array.isArray(value.rules) ? value.rules.filter((r): r is string => typeof r === 'string') : [];
  if (typeof value.title !== 'string') problems.push(`${id}/category.json: "title" must be a string`);
  if (value.cwe !== null && value.cwe !== undefined && (typeof value.cwe !== 'string' || !CWE.test(value.cwe))) {
    problems.push(`${id}/category.json: "cwe" must look like CWE-79 or be null`);
  }
  if (rules.length === 0) problems.push(`${id}/category.json: "rules" must name at least one rule`);
  for (const rule of rules) {
    if (!RULE_ID.test(rule)) problems.push(`${id}/category.json: rule "${rule}" must be <plugin>/<rule>`);
  }
  const overrides =
    value.overrides !== undefined && typeof value.overrides === 'object' && value.overrides !== null
      ? (value.overrides as Record<string, RuleEntry>)
      : {};
  for (const rule of Object.keys(overrides)) {
    if (!RULE_ID.test(rule)) problems.push(`${id}/category.json: override "${rule}" must be <plugin>/<rule>`);
  }
  return {
    title: typeof value.title === 'string' ? value.title : id,
    cwe: typeof value.cwe === 'string' ? value.cwe : null,
    rules,
    overrides,
  };
}

function readCase(
  categoryDir: string,
  fileName: string,
  plugin: string,
  category: string,
  config: CategoryConfig,
  problems: string[],
): CorpusCase | null {
  const file = `${plugin}/${category}/${fileName}`;
  const name = CASE_FILE.exec(fileName);
  if (name === null) {
    problems.push(`${file}: the name must be <pair>.vuln.<ext>.case or <pair>.safe[-<n>].<ext>.case`);
    return null;
  }
  const [, pair = '', kind = 'vuln'] = name;
  const absolutePath = join(categoryDir, fileName);
  const source = readFileSync(absolutePath, 'utf8');
  const fields = parseHeader(source.split(/\r?\n/u, 1)[0] ?? '');
  if (fields === null) {
    problems.push(`${file}: line 1 must be the "// @bench ..." header`);
    return null;
  }
  for (const key of ['category', 'framework', 'pair', 'title']) {
    if (!fields[key]) problems.push(`${file}: the header has no ${key}=`);
  }
  if (fields.category !== undefined && fields.category !== category) {
    problems.push(`${file}: the header says category=${fields.category} but the file is in ${category}/`);
  }
  if (fields.pair !== undefined && fields.pair !== pair) {
    problems.push(`${file}: the header says pair=${fields.pair} but the file name says ${pair}`);
  }
  if (fields.cwe !== undefined && !CWE.test(fields.cwe)) {
    problems.push(`${file}: cwe=${fields.cwe} must look like CWE-79`);
  }
  const expects = parseExpects(source);
  const ok = hasOkMarker(source);
  if (kind === 'vuln' && expects.length === 0) problems.push(`${file}: a vuln case needs an "// expect: <plugin>/<rule>" label`);
  if (kind === 'vuln' && ok) problems.push(`${file}: a vuln case must not carry "// ok"`);
  if (kind === 'safe' && !ok) problems.push(`${file}: a safe case needs a line that is only "// ok"`);
  if (kind === 'safe' && expects.length > 0) problems.push(`${file}: a safe case must not carry expect labels`);
  for (const label of expects) {
    if (!config.rules.includes(label.rule)) {
      problems.push(`${file}:${label.line}: "${label.rule}" is not one of this category's rules (${config.rules.join(', ')})`);
    }
  }
  return {
    file,
    absolutePath,
    lintPath: absolutePath.slice(0, -'.case'.length),
    plugin,
    kind: kind as CaseKind,
    meta: {
      category,
      cwe: fields.cwe ?? config.cwe,
      framework: fields.framework ?? '',
      pair,
      title: fields.title ?? '',
    },
    expects,
    source,
    lintSource: maskBenchComments(source),
  };
}

function subdirectories(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

/**
 * Loads every category under `root` (optionally only the named plugins) and
 * throws a {@link CorpusError} listing every problem at once.
 */
export function loadCorpus(root: string, plugins?: readonly string[]): Corpus {
  const problems: string[] = [];
  const categories: Category[] = [];
  for (const plugin of subdirectories(root)) {
    if (plugins !== undefined && !plugins.includes(plugin)) continue;
    for (const name of subdirectories(join(root, plugin))) {
      const id = `${plugin}/${name}`;
      const dir = join(root, plugin, name);
      const config = readCategoryConfig(join(dir, 'category.json'), id, problems);
      if (config === null) continue;
      for (const rule of [...config.rules, ...Object.keys(config.overrides)]) {
        if (!rule.startsWith(`${plugin}/`)) problems.push(`${id}/category.json: "${rule}" belongs to another plugin`);
      }
      const cases = readdirSync(dir)
        .filter((file) => file !== 'category.json')
        .sort()
        .map((file) => readCase(dir, file, plugin, name, config, problems))
        .filter((c): c is CorpusCase => c !== null);
      const pairs = new Map<string, Set<CaseKind>>();
      for (const c of cases) pairs.set(c.meta.pair, (pairs.get(c.meta.pair) ?? new Set()).add(c.kind));
      for (const [pair, kinds] of pairs) {
        if (!kinds.has('vuln')) problems.push(`${id}: pair "${pair}" has no vuln case`);
        if (!kinds.has('safe')) problems.push(`${id}: pair "${pair}" has no safe twin`);
      }
      categories.push({ id, plugin, name, config, cases });
    }
  }
  if (problems.length > 0) throw new CorpusError(problems);
  return { root, categories };
}
