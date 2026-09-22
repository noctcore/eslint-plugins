/**
 * Post-build check of dist/. A green `astro build` proves little here: a wrong
 * `base` builds fine and 404s every asset, and a dropped rule page builds fine
 * too. This reads what was actually emitted.
 *
 * 1. One page per rule doc, at rules/<short>/<rule>/index.html.
 * 2. Every ESLint rule's baked-in `meta.docs.url` resolves to an emitted page.
 * 3. Every root-relative href/src in every page sits under the deploy base and
 *    resolves to an emitted file.
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

console.log(
  `check-build: ${pages.length} HTML pages, ${rulePages.length} rule pages for ${docs.length} docs, ` +
    `${urlsChecked} meta.docs.url checked, ${linksChecked} root-relative links checked`,
);
if (failures.length > 0) {
  const unique = [...new Set(failures)];
  console.error(`check-build: ${unique.length} failure(s)\n  ${unique.slice(0, 50).join('\n  ')}`);
  process.exit(1);
}
