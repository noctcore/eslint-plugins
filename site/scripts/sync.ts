/**
 * Prebuild sync: turns the 100 `packages/*\/docs/rules/*.md` files into Starlight
 * pages, and each plugin's exported `rules` + `meta` into the catalog the package
 * pages and the landing page render their tables from.
 *
 * Nothing here is hand-maintained. The rule docs stay the single source of
 * truth (their fences are executed by each package's test suite); this step
 * only derives what Starlight needs from them:
 *
 * - frontmatter, from the `#` title and the blockquote summary;
 * - fence meta, rewritten from the test harness's (`ts bad reports=2
 *   options={...}`) into Expressive Code's (`ts title="..." verdict=bad`). EC
 *   parses `key={...}` as a line-range marker, so the raw meta cannot pass
 *   through untouched;
 * - links: sibling rule docs become sibling rule pages, anything else relative
 *   points at the file on GitHub.
 *
 * Output lands in gitignored paths and is rebuilt from scratch every run.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACKAGES_DIR,
  REPO_ROOT,
  REPO_URL,
  listRuleDocs,
  loadInventory,
  ruleRoute,
  type PackageEntry,
  type RuleEntry,
} from './inventory';
import { deprecationSentence, stripRuleHeader } from './readmes';
import { HERO } from '../src/lib/stacks';
import { checkRuleDocSections } from './structure';

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULES_OUT = join(SITE_DIR, 'src', 'content', 'docs', 'rules');
const CATALOG_OUT = join(SITE_DIR, 'src', 'generated', 'catalog.json');
const HERO_OUT = join(SITE_DIR, 'src', 'generated', 'hero.json');

const FENCE = /^(\s*)```(\S*)[ \t]*(.*)$/;
const VERDICTS = new Set(['bad', 'good', 'prose']);

interface FenceMeta {
  verdict: string | null;
  filename: string | null;
  reports: number | null;
  options: string | null;
}

/**
 * Parse the test harness's fence meta. Tokens are space separated, except that
 * `options=` carries a JSON value that may itself contain spaces, and
 * `reason="..."` is a quoted string.
 */
export function parseFenceMeta(meta: string): FenceMeta {
  const out: FenceMeta = { verdict: null, filename: null, reports: null, options: null };
  let i = 0;
  while (i < meta.length) {
    while (meta[i] === ' ') i++;
    if (i >= meta.length) break;
    const rest = meta.slice(i);
    if (rest.startsWith('options=')) {
      let depth = 0;
      let j = i + 'options='.length;
      let inString = false;
      for (; j < meta.length; j++) {
        const c = meta[j];
        if (inString) {
          if (c === '\\') j++;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      out.options = meta.slice(i + 'options='.length, j);
      i = j;
      continue;
    }
    if (rest.startsWith('reason="')) {
      const end = meta.indexOf('"', i + 'reason="'.length);
      i = end === -1 ? meta.length : end + 1;
      continue;
    }
    const end = meta.indexOf(' ', i);
    const token = meta.slice(i, end === -1 ? meta.length : end);
    i = end === -1 ? meta.length : end;
    if (VERDICTS.has(token)) out.verdict = token;
    else if (token.startsWith('filename=')) out.filename = token.slice('filename='.length);
    else if (token.startsWith('reports=')) out.reports = Number(token.slice('reports='.length));
    // `relocation`, `reconfigured` and anything else only steer the test harness.
  }
  return out;
}

function fenceTitle(meta: FenceMeta): string | null {
  const parts: string[] = [];
  if (meta.verdict === 'bad') parts.push('Incorrect');
  if (meta.verdict === 'good') parts.push('Correct');
  if (meta.filename) parts.push(meta.filename);
  if (meta.verdict === 'bad' && meta.reports !== null && meta.reports > 1) {
    parts.push(`${meta.reports} reports`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

const LINE_COMMENT: Record<string, string> = {
  ts: '//',
  tsx: '//',
  js: '//',
  jsx: '//',
  jsonc: '//',
};

/** Where a relative link in a rule doc should point on the site. */
function rewriteLink(target: string, docPath: string): string {
  const [pathPart, hash] = target.split('#', 2) as [string, string | undefined];
  const fragment = hash === undefined ? '' : `#${hash}`;
  const abs = resolve(dirname(docPath), pathPart);
  const rel = relative(PACKAGES_DIR, abs).split('/');
  // packages/<pkg>/docs/rules/<rule>.md -> the rule's page.
  if (rel.length === 4 && rel[1] === 'docs' && rel[2] === 'rules' && rel[3]!.endsWith('.md')) {
    const pkg = rel[0]!;
    const targetShort = pkg.startsWith('eslint-plugin-') ? pkg.slice('eslint-plugin-'.length) : pkg;
    const targetRule = rel[3]!.slice(0, -3);
    // A rule page lives at rules/<short>/<rule>/, two levels under rules/.
    return `../../${targetShort}/${targetRule}/${fragment}`;
  }
  return `${REPO_URL}/blob/main/${relative(REPO_ROOT, abs)}${fragment}`;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The doc's `> summary` blockquote as the page's lead paragraph. The summary is
 * Markdown (code spans, bold), so it stays Markdown inside the wrapper and the
 * site's own renderer turns it into HTML; the blank lines around it are what
 * make that happen inside an HTML block.
 */
function lead(quote: readonly string[]): string[] {
  const text = quote.map((line) => line.replace(/^>\s?/, ''));
  return ['<div class="rule-lead">', '', ...text, '', '</div>'];
}

/** A replacement rule's page, relative to a rule page at rules/<short>/<rule>/. */
function siteRelativeLink(id: string): string {
  const match = /^noctcore-([^/]+)\/(.+)$/.exec(id);
  return match ? `[\`${id}\`](../../${match[1]}/${match[2]}/)` : `\`${id}\``;
}

/** Starlight's caution aside, so a deprecated rule says so before anything else on its page. */
function deprecationBanner(rule: RuleEntry): string[] {
  if (!rule.deprecated) return [];
  return ['', ':::caution[Deprecated]', deprecationSentence(rule, siteRelativeLink), ':::'];
}

/**
 * The page description: the blockquote summary as plain text, without its
 * bold status lines (`**Opt-in.**`).
 */
export function docSummary(quote: readonly string[]): string {
  return plainText(summaryMarkdown(quote));
}

function summaryMarkdown(quote: readonly string[]): string {
  return quote
    .map((line) => line.replace(/^>\s?/, ''))
    .filter((line) => !/^\*\*.*\*\*\.?$/.test(line.trim()))
    .join(' ');
}

/** The heading's rule id and the blockquote summary of a rule doc, with the line after the quote. */
function docHead(lines: readonly string[], docPath: string): { title: string; quote: string[]; end: number } {
  const heading = /^# `([^`]+)`\s*$/.exec(lines[0] ?? '');
  if (!heading) throw new Error(`${docPath}: first line must be "# \`<rule id>\`"`);
  let i = 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const quoteStart = i;
  while (i < lines.length && lines[i]!.startsWith('>')) i++;
  if (i === quoteStart) throw new Error(`${docPath}: expected a "> summary" blockquote after the title`);
  return { title: heading[1]!, quote: lines.slice(quoteStart, i), end: i };
}

/**
 * The overview's hero diagnostic, read from a rule doc so it cannot drift from
 * the rule: the first block of the doc's first Incorrect fence (up to its first
 * blank line, leading `//` comment lines dropped), where `highlight` first
 * appears in it (1-based line and column, as ESLint reports them), and the
 * summary with its code spans kept. Throws when the doc has no Incorrect fence
 * or the block no longer contains `highlight`, so a doc edit fails the build.
 */
export function heroExample(
  source: string,
  highlight: string,
  docPath = 'rule doc',
): { code: string; line: number; column: number; summary: string } {
  const lines = stripRuleHeader(source.replace(/\r\n/g, '\n')).split('\n');
  const { quote, end } = docHead(lines, docPath);
  const open = lines.findIndex((line, i) => {
    const fence = i >= end ? FENCE.exec(line) : null;
    return fence !== null && parseFenceMeta(fence[3] ?? '').verdict === 'bad';
  });
  if (open === -1) throw new Error(`${docPath}: no Incorrect (\`bad\`) fence for the hero example`);
  const block: string[] = [];
  for (const line of lines.slice(open + 1)) {
    if (FENCE.test(line) || line.trim() === '') break;
    block.push(line);
  }
  while (block.length > 0 && /^\s*\/\//.test(block[0]!)) block.shift();
  const row = block.findIndex((line) => line.includes(highlight));
  if (row === -1) throw new Error(`${docPath}: the first Incorrect block no longer contains "${highlight}"`);
  const summary = summaryMarkdown(quote)
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { code: block.join('\n'), line: row + 1, column: block[row]!.indexOf(highlight) + 1, summary };
}

/**
 * Render one rule doc as a Starlight page. Throws on a doc out of shape. The
 * doc's generated status header is dropped: the page shows the same facts in
 * its facts panel (src/lib/facts.ts, rendered by the page's components), and
 * showing both would say everything twice.
 */
export function renderRuleDoc(source: string, docPath: string, _pkg: PackageEntry, rule: RuleEntry): string {
  const lines = stripRuleHeader(source.replace(/\r\n/g, '\n')).split('\n');
  // The blockquote summary: the first run of `>` lines after the heading.
  const { title, quote, end: i } = docHead(lines, docPath);
  const summary = docSummary(quote);

  const body: string[] = [...lead(quote), ...deprecationBanner(rule)];
  let inFence = false;
  for (const line of lines.slice(i)) {
    const fence = FENCE.exec(line);
    if (fence && !inFence) {
      inFence = true;
      const [, indent, lang, rawMeta] = fence as unknown as [string, string, string, string];
      const meta = parseFenceMeta(rawMeta);
      const title = fenceTitle(meta);
      const attrs = [lang];
      if (title) attrs.push(`title=${JSON.stringify(title)}`);
      if (meta.verdict === 'bad' || meta.verdict === 'good') attrs.push(`verdict=${meta.verdict}`);
      body.push(`${indent}\`\`\`${attrs.join(' ')}`);
      const comment = LINE_COMMENT[lang];
      if (meta.options && comment) body.push(`${indent}${comment} rule options: ${meta.options}`);
      continue;
    }
    if (fence && inFence && fence[2] === '' && fence[3] === '') {
      inFence = false;
      body.push(line);
      continue;
    }
    if (inFence) {
      body.push(line);
      continue;
    }
    body.push(
      line.replace(/\]\((\.{1,2}\/[^)\s]+)\)/g, (_, target: string) => {
        return `](${rewriteLink(target, docPath)})`;
      }),
    );
  }
  if (inFence) throw new Error(`${docPath}: unterminated code fence`);
  checkRuleDocSections(source, docPath, rule);

  const repoPath = relative(REPO_ROOT, docPath);
  const frontmatter = [
    '---',
    `# Generated by site/scripts/sync.ts from ${repoPath}. Edit that file, not this one.`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(summary)}`,
    'sidebar:',
    `  label: ${JSON.stringify(rule.name)}`,
    ...(rule.deprecated ? ['  badge:', '    text: Deprecated', '    variant: caution'] : []),
    `editUrl: ${JSON.stringify(`${REPO_URL}/edit/main/${repoPath}`)}`,
    '---',
    '',
  ];
  return [...frontmatter, ...body].join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The catalog the components read (src/generated/catalog.json): the inventory
 * with each package's repo path and each rule's route. Exported so the site
 * tests build the same shape from source, without a sync having run.
 */
export function catalogOf(inventory: readonly PackageEntry[]) {
  return inventory.map(({ dir, ...pkg }) => ({
    ...pkg,
    repoDir: relative(REPO_ROOT, dir),
    rules: pkg.rules.map((rule) => ({ ...rule, route: ruleRoute(pkg.short, rule.name) })),
  }));
}

export type CatalogEntry = ReturnType<typeof catalogOf>[number];

async function main(): Promise<void> {
  const inventory = await loadInventory();
  const docs = listRuleDocs();

  // The parity test is the real guard; failing here too keeps a broken tree
  // from publishing a site with a missing or orphaned page.
  const byKey = new Map<string, { pkg: PackageEntry; rule: RuleEntry }>(
    inventory.flatMap((pkg) => pkg.rules.map((rule) => [`${pkg.short}/${rule.name}`, { pkg, rule }] as const)),
  );
  const docKeys = new Set(docs.map((doc) => `${doc.short}/${doc.rule}`));
  const orphanDocs = [...docKeys].filter((key) => !byKey.has(key));
  const undocumented = [...byKey.keys()].filter((key) => !docKeys.has(key));
  if (orphanDocs.length > 0 || undocumented.length > 0) {
    throw new Error(
      `rule/doc parity broken. Docs with no rule: ${orphanDocs.join(', ') || 'none'}. Rules with no doc: ${undocumented.join(', ') || 'none'}.`,
    );
  }

  rmSync(RULES_OUT, { recursive: true, force: true });
  for (const doc of docs) {
    const { pkg, rule } = byKey.get(`${doc.short}/${doc.rule}`)!;
    const out = join(RULES_OUT, doc.short, `${doc.rule}.md`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderRuleDoc(readFileSync(doc.path, 'utf8'), doc.path, pkg, rule));
  }

  mkdirSync(dirname(CATALOG_OUT), { recursive: true });
  writeFileSync(CATALOG_OUT, `${JSON.stringify(catalogOf(inventory), null, 2)}\n`);

  const heroDoc = docs.find((doc) => doc.short === HERO.short && doc.rule === HERO.rule);
  const heroRule = byKey.get(`${HERO.short}/${HERO.rule}`);
  if (!heroDoc || !heroRule) throw new Error(`the hero rule ${HERO.short}/${HERO.rule} has no doc`);
  const hero = {
    id: heroRule.rule.id,
    route: ruleRoute(HERO.short, HERO.rule),
    file: HERO.file,
    highlight: HERO.highlight,
    ...heroExample(readFileSync(heroDoc.path, 'utf8'), HERO.highlight, heroDoc.path),
  };
  writeFileSync(HERO_OUT, `${JSON.stringify(hero, null, 2)}\n`);

  const counts = inventory.map((pkg) => `${pkg.short}=${pkg.rules.length}`).join(' ');
  console.log(`sync: ${docs.length} rule pages, ${inventory.length} packages (${counts})`);
}

if (import.meta.main) await main();
