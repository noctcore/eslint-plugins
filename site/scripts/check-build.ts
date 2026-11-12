/**
 * Post-build check of dist/. A green `astro build` proves little here: a wrong
 * `base` builds fine and 404s every asset, and a dropped rule page builds fine
 * too. This reads what was actually emitted.
 *
 * 1. One page per rule doc, at rules/<short>/<rule>/index.html.
 * 2. Every ESLint rule's baked-in `meta.docs.url` resolves to an emitted page.
 * 3. Every root-relative href/src in every page sits under the deploy base and
 *    resolves to an emitted file.
 * 4. dist/rules.json exists, parses, has exactly one entry per rule doc, and
 *    every `url` in it resolves to an emitted page. It is a public contract
 *    (see src/lib/rules-index.ts), and a generated contract with no check rots.
 * 5. dist/llms.txt exists and points at rules.json.
 * 6. Every page carries the search palette, and no Pagefind index is emitted
 *    (the palette replaces it).
 * 7. Every rule page carries the facts panel with its copyable rule id and the
 *    "on this page" column, and its previous and next links point at the
 *    neighbouring rules in catalog order (none before the first rule, none
 *    after the last).
 * 8. The rules board offers strict on exactly the package pages whose plugin
 *    ships a strict preset (and there is at least one), and every plugin page
 *    carries the generated config and the "bad fit" line.
 * 9. dist/404.html is the site's own not-found page (check 3 already walks its
 *    links, as it does for every page).
 * 10. Nothing emitted loads Google Fonts: every font is self-hosted.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_BASE, SITE_ORIGIN, listRuleDocs, loadInventory } from './inventory';

const DIST = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Map a site path (`/eslint-plugins/x/`) to the emitted file, or null. */
function emitted(pathname: string): string | null {
  if (!pathname.startsWith(`${SITE_BASE}/`)) return null;
  const rel = decodeURIComponent(pathname.slice(SITE_BASE.length + 1));
  const candidates = rel === '' || rel.endsWith('/') ? [join(DIST, rel, 'index.html')] : [join(DIST, rel), join(DIST, rel, 'index.html')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const failures: string[] = [];
const files = walk(DIST);
const pages = files.filter((f) => f.endsWith('.html'));

const docs = listRuleDocs();
const rulePages = pages.filter((f) => /\/rules\/[^/]+\/[^/]+\/index\.html$/.test(f));
for (const doc of docs) {
  if (!existsSync(join(DIST, 'rules', doc.short, doc.rule, 'index.html'))) {
    failures.push(`no page emitted for ${doc.short}/${doc.rule}`);
  }
}
if (rulePages.length !== docs.length) {
  failures.push(`${rulePages.length} rule pages emitted for ${docs.length} rule docs`);
}

const inventory = await loadInventory();
let urlsChecked = 0;
for (const pkg of inventory) {
  for (const rule of pkg.rules) {
    if (rule.docsUrl === null) continue;
    urlsChecked++;
    if (!rule.docsUrl.startsWith(`${SITE_ORIGIN}${SITE_BASE}/`)) {
      failures.push(`${rule.id}: meta.docs.url is not on the site: ${rule.docsUrl}`);
      continue;
    }
    if (!emitted(new URL(rule.docsUrl).pathname)) {
      failures.push(`${rule.id}: meta.docs.url does not resolve to an emitted page: ${rule.docsUrl}`);
    }
  }
}

let linksChecked = 0;
const refPattern = /\s(?:href|src)="(\/[^"#?]*)[^"]*"/g;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const match of html.matchAll(refPattern)) {
    const target = match[1]!;
    if (target.startsWith('//')) continue;
    linksChecked++;
    if (!target.startsWith(`${SITE_BASE}/`)) {
      failures.push(`${page.slice(DIST.length)}: "${target}" is outside the ${SITE_BASE}/ base`);
    } else if (!emitted(target)) {
      failures.push(`${page.slice(DIST.length)}: "${target}" does not resolve to an emitted file`);
    }
  }
}

// 4. The machine-readable index. Entries are keyed the same way docs are
// (package short name + rule name) so the comparison is exact in both
// directions: a missing entry, an extra entry and a duplicate all fail.
const RULES_JSON = join(DIST, 'rules.json');
let indexEntries = 0;
let indexUrlsChecked = 0;
function shortNameOf(npmName: string): string {
  return npmName.startsWith('@noctcore/eslint-plugin-') ? npmName.slice('@noctcore/eslint-plugin-'.length) : npmName.slice('@noctcore/'.length);
}
if (!existsSync(RULES_JSON)) {
  failures.push('dist/rules.json was not emitted');
} else {
  let index: { count?: unknown; rules?: unknown } | null = null;
  try {
    index = JSON.parse(readFileSync(RULES_JSON, 'utf8'));
  } catch (error) {
    failures.push(`dist/rules.json does not parse: ${(error as Error).message}`);
  }
  const entries = Array.isArray(index?.rules) ? (index!.rules as { name?: unknown; package?: unknown; url?: unknown }[]) : null;
  if (index && !entries) failures.push('dist/rules.json has no "rules" array');
  if (entries) {
    indexEntries = entries.length;
    if (index!.count !== entries.length) failures.push(`rules.json: "count" is ${String(index!.count)} for ${entries.length} entries`);
    const keys = entries.map((e) => (typeof e.package === 'string' && typeof e.name === 'string' ? `${shortNameOf(e.package)}/${e.name}` : '(malformed entry)'));
    const docKeys = new Set(docs.map((doc) => `${doc.short}/${doc.rule}`));
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) failures.push(`rules.json: duplicate entry for ${key}`);
      seen.add(key);
      if (!docKeys.has(key)) failures.push(`rules.json: entry ${key} has no rule doc`);
    }
    for (const key of docKeys) {
      if (!seen.has(key)) failures.push(`rules.json: no entry for rule doc ${key}`);
    }
    if (entries.length !== docs.length) failures.push(`rules.json: ${entries.length} entries for ${docs.length} rule docs`);
    for (const [i, entry] of entries.entries()) {
      const key = keys[i]!;
      if (typeof entry.url !== 'string' || !entry.url.startsWith(`${SITE_ORIGIN}${SITE_BASE}/`)) {
        failures.push(`rules.json: ${key}: url is not on the site: ${String(entry.url)}`);
        continue;
      }
      indexUrlsChecked++;
      if (!emitted(new URL(entry.url).pathname)) {
        failures.push(`rules.json: ${key}: url does not resolve to an emitted page: ${entry.url}`);
      }
    }
  }
}

// 5. llms.txt sits at the site root and points at the index.
const LLMS_TXT = join(DIST, 'llms.txt');
if (!existsSync(LLMS_TXT)) {
  failures.push('dist/llms.txt was not emitted');
} else {
  const text = readFileSync(LLMS_TXT, 'utf8');
  if (!text.startsWith('# ')) failures.push('llms.txt does not start with an H1');
  for (const route of ['rules.json', 'rules/']) {
    const url = `${SITE_ORIGIN}${SITE_BASE}/${route}`;
    if (!text.includes(`](${url})`)) failures.push(`llms.txt does not link ${url}`);
  }
}

// 6. The search palette on every page, and no Pagefind output beside it.
let pagesWithPalette = 0;
for (const page of pages) {
  if (readFileSync(page, 'utf8').includes('id="search-palette"')) pagesWithPalette++;
  else failures.push(`${page.slice(DIST.length)}: no search palette`);
}
if (existsSync(join(DIST, 'pagefind'))) failures.push('dist/pagefind was emitted; the search palette replaces it');

// 7. The rule page frame: facts panel, rule id, contents column, pager.
const ruleOrder = inventory.flatMap((pkg) => pkg.rules.map((rule) => ({ short: pkg.short, name: rule.name, id: rule.id })));
const pagerHref = (html: string, rel: 'prev' | 'next'): string | null => {
  const anchor = new RegExp(`<a\\b[^>]*\\brel="${rel}"[^>]*>`).exec(html)?.[0];
  return anchor ? (/\bhref="([^"]*)"/.exec(anchor)?.[1] ?? '') : null;
};
let rulePagesFramed = 0;
for (const [i, rule] of ruleOrder.entries()) {
  const page = join(DIST, 'rules', rule.short, rule.name, 'index.html');
  if (!existsSync(page)) continue;
  const html = readFileSync(page, 'utf8');
  const where = `rules/${rule.short}/${rule.name}`;
  rulePagesFramed++;
  if (!html.includes('class="rule-facts"')) failures.push(`${where}: no facts panel`);
  if (!html.includes(`data-copy-text="${rule.id}"`)) failures.push(`${where}: no copyable rule id ${rule.id}`);
  if (!html.includes('<starlight-toc')) failures.push(`${where}: no "on this page" column`);
  for (const [rel, neighbour] of [
    ['prev', ruleOrder[i - 1]],
    ['next', ruleOrder[i + 1]],
  ] as const) {
    const expected = neighbour ? `${SITE_BASE}/rules/${neighbour.short}/${neighbour.name}/` : null;
    const actual = pagerHref(html, rel);
    if (actual !== expected) failures.push(`${where}: ${rel} link is ${actual ?? 'missing'}, expected ${expected ?? 'none'}`);
  }
}

// 8. Package pages: strict switch, config output, bad fit line.
const plugins = inventory.filter((pkg) => pkg.kind === 'eslint-plugin');
const strictExpected = plugins.filter((pkg) => pkg.rules.some((rule) => rule.strict !== null)).map((pkg) => pkg.short);
const strictFound: string[] = [];
for (const pkg of inventory) {
  const page = join(DIST, 'packages', pkg.short, 'index.html');
  if (!existsSync(page)) {
    failures.push(`packages/${pkg.short}: no page emitted`);
    continue;
  }
  const html = readFileSync(page, 'utf8');
  if (html.includes('data-preset="strict"')) strictFound.push(pkg.short);
  if (!html.includes('class="pkg-notfit"')) failures.push(`packages/${pkg.short}: no "bad fit" line`);
  if (pkg.kind === 'eslint-plugin' && !html.includes('data-config-output')) failures.push(`packages/${pkg.short}: no generated config`);
}
if (strictExpected.length === 0) failures.push('no plugin ships a strict preset, so the strict switch check proves nothing');
if (strictFound.join() !== strictExpected.join()) {
  failures.push(`strict is offered on [${strictFound.join(', ')}], expected [${strictExpected.join(', ')}]`);
}

// 9. The not-found page.
const NOT_FOUND = join(DIST, '404.html');
if (!existsSync(NOT_FOUND)) failures.push('dist/404.html was not emitted');
else if (!readFileSync(NOT_FOUND, 'utf8').includes('class="not-found')) failures.push('dist/404.html is not the site\'s own 404 page');

// 10. Self-hosted fonts only.
const TEXT_FILE = /\.(?:html|css|js|mjs|json|txt|xml|svg)$/;
let textFilesScanned = 0;
for (const file of files.filter((f) => TEXT_FILE.test(f))) {
  textFilesScanned++;
  const text = readFileSync(file, 'utf8');
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (text.includes(host)) failures.push(`${file.slice(DIST.length)}: mentions ${host}`);
  }
}
const fontFiles = files.filter((f) => f.endsWith('.woff2')).length;
if (fontFiles === 0) failures.push('no .woff2 font emitted; the self-hosted fonts are missing');

console.log(
  `check-build: ${pages.length} HTML pages, ${rulePages.length} rule pages for ${docs.length} docs, ` +
    `${urlsChecked} meta.docs.url checked, ${linksChecked} root-relative links checked, ` +
    `rules.json ${indexEntries} entries with ${indexUrlsChecked} urls checked, ` +
    `search palette on ${pagesWithPalette} pages, ${rulePagesFramed} rule page frames checked, ` +
    `strict offered on ${strictFound.length} package pages, ` +
    `${textFilesScanned} text files free of Google Fonts, ${fontFiles} woff2 fonts`,
);
if (failures.length > 0) {
  const unique = [...new Set(failures)];
  console.error(`check-build: ${unique.length} failure(s)\n  ${unique.slice(0, 50).join('\n  ')}`);
  process.exit(1);
}
