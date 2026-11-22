/**
 * The shape every package README and rule doc keeps, so a reader finds the
 * same thing in the same place on every page. `sync.ts` checks each rule doc
 * while rendering it, which fails `bun run docs:build`; `structure.test.ts`
 * checks every README and rule doc under `bun run test`. CONTRIBUTING.md
 * describes both templates.
 */
import type { PackageEntry, RuleDetails, RuleEntry, SchemaLike } from './inventory';

/**
 * The packages whose rule docs follow the rule page template
 * (`RULE_PAGE_SECTIONS`); every other package keeps `RULE_DOC_SECTIONS` until
 * it is converted. Converting a package means adding it here, in the same
 * commit that rewrites its docs. When every package is listed, the old
 * template goes.
 */
export const RULE_PAGE_PACKAGES: readonly string[] = ['architecture'];

/**
 * The `##` sections of a rule page, in order. `Options` is there exactly when
 * the rule takes options; `Related` and `Credits` are optional.
 */
export const RULE_PAGE_SECTIONS = [
  'In short',
  'What you will see',
  'Code that triggers it',
  'What it does not flag',
  'Options',
  'When not to use it',
  'Related',
  'Credits',
] as const;

/** The package short name of an ESLint rule id (`noctcore-<short>/<rule>`), or null. */
export function packageOfRule(rule: RuleEntry): string | null {
  return /^noctcore-([^/]+)\//.exec(rule.id)?.[1] ?? null;
}

/** Whether a rule's doc is on the rule page template. */
export function isRulePage(rule: RuleEntry): boolean {
  const short = packageOfRule(rule);
  return short !== null && RULE_PAGE_PACKAGES.includes(short);
}

/**
 * The `##` sections a rule doc may have, in the order it must have them.
 * `Options` is there exactly when the rule takes options; `Related` and
 * `Credits` (a ported rule's licence notice) are optional; the rest are
 * required. Anything rule-specific goes in a `###` under one of these.
 */
export const RULE_DOC_SECTIONS = [
  'Why',
  'What it flags',
  'What it does not flag',
  'Options',
  'When not to use it',
  'Related',
  'Credits',
] as const;

/**
 * The `##` sections of an ESLint plugin's README, in order. `Opt-in rules` is
 * there when the package has a rule that is not on in `recommended` or needs
 * options; `Credits` is optional.
 */
export const PLUGIN_README_SECTIONS = [
  'Requirements',
  'Install',
  'Quick start',
  'Strict preset',
  'Opt-in rules',
  'Rules',
  'Severity policy',
  'Credits',
] as const;

/** `lint-meta-rules` is not an ESLint plugin and runs under the harness instead. */
export const LINT_META_README_SECTIONS = ['What it checks', 'Install', 'Run with the harness', 'Rules'] as const;

/** The `##` headings of a markdown document, skipping fenced code. */
export function h2Headings(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence && line.startsWith('## ')) headings.push(line.slice(3).trim());
  }
  return headings;
}

function list(headings: readonly string[]): string {
  return headings.map((heading) => `"## ${heading}"`).join(', ') || 'none';
}

/**
 * Throw unless `headings` are exactly `template` in order, minus the sections
 * `keep` drops. An unknown heading gets its own message, since the fix is a
 * `###` under a template section rather than a move.
 */
function expectSections(
  headings: readonly string[],
  template: readonly string[],
  keep: (section: string) => boolean,
  path: string,
  kind: string,
): void {
  const expected = template.filter(keep);
  if (headings.join('\n') === expected.join('\n')) return;
  const unknown = headings.filter((heading) => !template.includes(heading));
  const detail =
    unknown.length > 0
      ? `unknown section(s) ${list(unknown)}; use a "###" under a template section`
      : `expected ${list(expected)}`;
  throw new Error(
    `${path}: sections must follow the ${kind} template (see CONTRIBUTING.md): ${detail}. Found ${list(headings)}.`,
  );
}

/** Throw unless a rule doc's `##` sections are the template's, in its order. */
export function checkRuleDocSections(source: string, path: string, rule: RuleEntry): void {
  const headings = h2Headings(source);
  if (isRulePage(rule)) {
    expectSections(
      headings,
      RULE_PAGE_SECTIONS,
      (section) => {
        if (section === 'Options') return rule.hasOptions;
        if (section === 'Related' || section === 'Credits') return headings.includes(section);
        return true;
      },
      path,
      'rule page',
    );
    checkRulePageBody(source, path);
    return;
  }
  expectSections(
    headings,
    RULE_DOC_SECTIONS,
    (section) => {
      if (section === 'Options') return rule.hasOptions;
      if (section === 'Related' || section === 'Credits') return headings.includes(section);
      return true;
    },
    path,
    'rule-doc',
  );
}

/** Throw unless a package README's `##` sections are its skeleton's, in order. */
export function checkReadmeSections(source: string, path: string, pkg: PackageEntry): void {
  const headings = h2Headings(source);
  if (pkg.kind === 'lint-meta') {
    expectSections(headings, LINT_META_README_SECTIONS, () => true, path, 'README');
    return;
  }
  const hasOptIn = pkg.rules.some(
    (rule) => (rule.recommended !== 'error' && rule.strict !== 'error') || rule.requiresOptions,
  );
  const hasStrict = pkg.rules.some((rule) => rule.strict !== null);
  expectSections(
    headings,
    PLUGIN_README_SECTIONS,
    (section) => {
      if (section === 'Strict preset') return hasStrict;
      if (section === 'Opt-in rules') return hasOptIn;
      if (section === 'Credits') return headings.includes(section);
      return true;
    },
    path,
    'README',
  );
}

/** The lines of each `##` section, keyed by heading, fenced code included. */
export function h2Sections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      current = [];
      sections.set(line.slice(3).trim(), current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

/** Sentences in a run of prose: a stop followed by a space or the end, ignoring code spans. */
function sentenceCount(text: string): number {
  const plain = text.replace(/`[^`]*`/g, 'x').replace(/\s+/g, ' ').trim();
  return plain === '' ? 0 : plain.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== '').length;
}

/**
 * The body rules of a rule page: `In short` is two or three plain sentences;
 * `What you will see` holds the generated message list; `Code that triggers
 * it` is one `###` per shape the rule reports, each a bad example, then a
 * paragraph led by `**The fix:**`, then the fixed code.
 */
export function checkRulePageBody(source: string, path: string): void {
  const sections = h2Sections(source);
  const fail = (detail: string): never => {
    throw new Error(`${path}: ${detail} (see "Rule page template" in CONTRIBUTING.md)`);
  };
  const short = (sections.get('In short') ?? []).filter((line) => line.trim() !== '');
  if (short.some((line) => /^\s*(```|[-*] |\d+\. |\||#|>)/.test(line))) {
    fail('"## In short" is plain sentences, with no list, table, quote, heading or code block');
  }
  const count = sentenceCount(short.join(' '));
  if (count < 2 || count > 3) fail(`"## In short" must be 2 or 3 sentences, found ${count}`);
  if (!(sections.get('What you will see') ?? []).some((line) => line.includes('<!-- begin generated messages -->'))) {
    fail('"## What you will see" needs the generated message list: run `bun run docs:readmes`');
  }
  const code = sections.get('Code that triggers it') ?? [];
  const shapes: { title: string; lines: string[] }[] = [];
  for (const line of code) {
    if (line.startsWith('### ')) shapes.push({ title: line.slice(4).trim(), lines: [] });
    else shapes.at(-1)?.lines.push(line);
  }
  if (shapes.length === 0) fail('"## Code that triggers it" needs one "###" per shape the rule reports');
  for (const { title, lines } of shapes) {
    const bad = lines.findIndex((line) => /^```\S+ bad\b/.test(line));
    const fix = lines.findIndex((line, i) => i > bad && line.startsWith('**The fix:**'));
    const good = lines.findIndex((line, i) => i > fix && /^```\S+ good\b/.test(line));
    if (bad === -1 || fix === -1 || good === -1) {
      fail(`"### ${title}" needs a bad example, then a "**The fix:**" paragraph, then the good example it describes`);
    }
  }
}

/** A JavaScript literal as the docs write it: single quotes, `[a, b]`, `{ k: v }`. */
export function jsLiteral(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(jsLiteral).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${k}: ${jsLiteral(v)}`).join(', ')} }`;
  }
  return String(value);
}

/** The TypeScript spelling of a simple JSON schema, or null when the docs name the shape themselves. */
export function schemaType(schema: SchemaLike): string | null {
  // A long union reads better under a name the docs give it (`SemanticCategory`).
  if (schema.enum) return schema.enum.length > 3 ? null : schema.enum.map(jsLiteral).join(' | ');
  if (schema.type === 'string' || schema.type === 'boolean' || schema.type === 'integer' || schema.type === 'number') {
    return schema.type;
  }
  if (schema.type === 'array' && schema.items) {
    const item = schemaType(schema.items);
    return item === null ? null : item.includes('|') ? `(${item})[]` : `${item}[]`;
  }
  if (schema.type === 'object' && typeof schema.additionalProperties === 'object' && !schema.properties) {
    const value = schemaType(schema.additionalProperties);
    return value === null ? null : `Record<string, ${value}>`;
  }
  return null;
}

/** The cells of a markdown table row, with escaped pipes kept inside their cell. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function codeSpan(cell: string): string | null {
  return /`([^`]*)`/.exec(cell)?.[1] ?? null;
}

/**
 * Throw unless the first `| Option | Type | Default | Meaning |` table under
 * `## Options` lists exactly the rule's top-level options, each simple type as
 * the schema spells it, each default the rule declares in `defaultOptions`,
 * and each deprecated alias (a schema description that starts "Deprecated
 * alias") as one.
 */
export function checkOptionsTable(source: string, path: string, details: RuleDetails): void {
  const lines = h2Sections(source).get('Options');
  const properties = details.optionsSchema?.properties;
  if (!lines || !properties) return;
  const fail = (detail: string): never => {
    throw new Error(`${path}: the Options table disagrees with the rule's schema: ${detail}`);
  };
  const header = lines.findIndex((line) => /^\|\s*Option\s*\|\s*Type\s*\|\s*Default\s*\|\s*Meaning\s*\|/.test(line));
  if (header === -1) fail('no "| Option | Type | Default | Meaning |" table');
  const rows: string[][] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(cells(line));
  }
  const documented = rows.map((row) => codeSpan(row[0] ?? '') ?? '');
  const declared = Object.keys(properties);
  const missing = declared.filter((key) => !documented.includes(key));
  const extra = documented.filter((key) => !declared.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(`missing ${missing.join(', ') || 'none'}; not in the schema ${extra.join(', ') || 'none'}`);
  }
  for (const [name, type, fallback, meaning] of rows) {
    const key = codeSpan(name ?? '')!;
    const schema = properties[key]!;
    const expectedType = schemaType(schema);
    if (expectedType !== null && codeSpan(type ?? '') !== expectedType) {
      fail(`\`${key}\` is \`${expectedType}\` in the schema, the table says ${type}`);
    }
    if (key in details.defaults) {
      const expected = jsLiteral(details.defaults[key]);
      if (codeSpan(fallback ?? '') !== expected) fail(`\`${key}\` defaults to \`${expected}\`, the table says ${fallback}`);
    }
    if (schema.description?.startsWith('Deprecated alias') && !(meaning ?? '').startsWith('Deprecated alias')) {
      fail(`\`${key}\` is a deprecated alias; its Meaning must say so first`);
    }
  }
}
