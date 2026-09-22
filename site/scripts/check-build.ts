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

let urlsChecked = 0;
for (const pkg of await loadInventory()) {
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

console.log(
  `check-build: ${pages.length} HTML pages, ${rulePages.length} rule pages for ${docs.length} docs, ` +
    `${urlsChecked} meta.docs.url checked, ${linksChecked} root-relative links checked, ` +
    `rules.json ${indexEntries} entries with ${indexUrlsChecked} urls checked`,
);
if (failures.length > 0) {
  const unique = [...new Set(failures)];
  console.error(`check-build: ${unique.length} failure(s)\n  ${unique.slice(0, 50).join('\n  ')}`);
  process.exit(1);
}
