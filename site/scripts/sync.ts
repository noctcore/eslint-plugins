/**
 * Prebuild sync: turns the 96 `packages/*\/docs/rules/*.md` files into Starlight
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
  SITE_BASE,
  listRuleDocs,
  loadInventory,
  ruleRoute,
  type PackageEntry,
  type RuleEntry,
} from './inventory';

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULES_OUT = join(SITE_DIR, 'src', 'content', 'docs', 'rules');
const CATALOG_OUT = join(SITE_DIR, 'src', 'generated', 'catalog.json');

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

function factsLine(pkg: PackageEntry, rule: RuleEntry): string {
  if (pkg.kind === 'lint-meta') {
    // A reader who lands here from search has no other route to what runs a
    // lint-meta rule: not ESLint, the harness. The package page explains it.
    return [
      `**Runs under:** [\`@noctcore/harness\` lint-meta](${SITE_BASE}/packages/${pkg.short}/), not ESLint`,
      `**Factory:** \`${rule.factory}\` from \`${rule.entry}\``,
      `**Category:** \`${rule.category}\``,
      `**Fails CI by default:** ${rule.ciCritical ? 'yes' : 'no'}`,
    ].join(' · ');
  }
  const typeInfo = { required: 'required', optional: 'used when available', none: 'not needed' };
  return [
    `**Recommended preset:** ${rule.recommended ? `\`${rule.recommended}\`` : 'not included'}`,
    `**Autofix:** ${rule.fixable ? 'yes' : 'no'}`,
    `**Suggestions:** ${rule.hasSuggestions ? 'yes' : 'no'}`,
    `**Type information:** ${typeInfo[rule.typeInfo]}`,
  ].join(' · ');
}

/** Render one rule doc as a Starlight page. Throws on a doc out of shape. */
export function renderRuleDoc(source: string, docPath: string, pkg: PackageEntry, rule: RuleEntry): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const heading = /^# `([^`]+)`\s*$/.exec(lines[0] ?? '');
  if (!heading) throw new Error(`${docPath}: first line must be "# \`<rule id>\`"`);
  const title = heading[1]!;

  // The blockquote summary: the first run of `>` lines after the heading.
  let i = 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const quoteStart = i;
  while (i < lines.length && lines[i]!.startsWith('>')) i++;
  if (i === quoteStart) throw new Error(`${docPath}: expected a "> summary" blockquote after the title`);
  const quote = lines.slice(quoteStart, i);
  const summary = plainText(
    quote
      .map((line) => line.replace(/^>\s?/, ''))
      .filter((line) => !/^\*\*.*\*\*\.?$/.test(line.trim()))
      .join(' '),
  );

  const body: string[] = [...quote, '', factsLine(pkg, rule)];
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

  const repoPath = relative(REPO_ROOT, docPath);
  const frontmatter = [
    '---',
    `# Generated by site/scripts/sync.ts from ${repoPath}. Edit that file, not this one.`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(summary)}`,
    'sidebar:',
    `  label: ${JSON.stringify(rule.name)}`,
    `editUrl: ${JSON.stringify(`${REPO_URL}/edit/main/${repoPath}`)}`,
    '---',
    '',
  ];
  return [...frontmatter, ...body].join('\n').replace(/\n{3,}/g, '\n\n');
}

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

  const catalog = inventory.map(({ dir, ...pkg }) => ({
    ...pkg,
    repoDir: relative(REPO_ROOT, dir),
    rules: pkg.rules.map((rule) => ({ ...rule, route: ruleRoute(pkg.short, rule.name) })),
  }));
  mkdirSync(dirname(CATALOG_OUT), { recursive: true });
  writeFileSync(CATALOG_OUT, `${JSON.stringify(catalog, null, 2)}\n`);

  const counts = inventory.map((pkg) => `${pkg.short}=${pkg.rules.length}`).join(' ');
  console.log(`sync: ${docs.length} rule pages, ${inventory.length} packages (${counts})`);
}

if (import.meta.main) await main();
