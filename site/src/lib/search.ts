/**
 * The search palette's index, ranking and keyboard shortcuts. Pure, so the
 * palette's client script and scripts/search.test.ts share one
 * implementation; it takes catalog-shaped data and never imports the
 * generated catalog itself.
 */
import { escapeHtml } from './format';
import { filterWords } from './rule-filters';
import { STARTER } from './stacks';

export type SearchKind = 'package' | 'rule' | 'check';

export interface SearchEntry {
  readonly kind: SearchKind;
  /** `<short>` for a package, `<short>/<name>` for a rule or check. */
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly meta: string;
  readonly href: string;
  /** Lowercased text every query word must occur in. */
  readonly hay: string;
  /** The rule id and name, for the exact-match bonus; empty for a package. */
  readonly exact: readonly string[];
}

export interface SearchPackage {
  readonly short: string;
  readonly npmName: string;
  readonly kind: string;
  readonly description: string;
  readonly rules: readonly { name: string; id: string; description: string; route: string }[];
}

const KIND_ORDER: Record<SearchKind, number> = { package: 0, rule: 1, check: 2 };
const EXACT_BONUS = 1000;

/** Markdown code spans read as plain words in a result line. */
const plain = (text: string) => text.replace(/`/g, '');

export function buildSearchIndex(catalog: readonly SearchPackage[], base: string): SearchEntry[] {
  const root = base.replace(/\/$/, '');
  const packages = catalog.map(
    (pkg): SearchEntry => ({
      kind: 'package',
      key: pkg.short,
      label: pkg.short,
      detail: plain(pkg.description),
      meta: `${pkg.rules.length} ${pkg.rules.length === 1 ? 'rule' : 'rules'}`,
      href: `${root}/packages/${pkg.short}/`,
      hay: `${pkg.short} ${pkg.npmName} ${plain(pkg.description)}`.toLowerCase(),
      exact: [],
    }),
  );
  const rules = catalog.flatMap((pkg) =>
    pkg.rules.map(
      (rule): SearchEntry => ({
        kind: pkg.kind === 'eslint-plugin' ? 'rule' : 'check',
        key: `${pkg.short}/${rule.name}`,
        label: rule.name,
        detail: plain(rule.description),
        meta: pkg.short,
        href: `${root}/${rule.route}`,
        hay: `${rule.name} ${rule.id} ${pkg.short} ${plain(rule.description)}`.toLowerCase(),
        exact: [rule.id.toLowerCase(), rule.name.toLowerCase()],
      }),
    ),
  );
  return [...packages, ...rules];
}

function score(entry: SearchEntry, words: readonly string[], query: string): number {
  const label = entry.label.toLowerCase();
  let total = 0;
  for (const word of words) {
    if (!entry.hay.includes(word)) return -1;
    total += label.includes(word) ? (label.startsWith(word) ? 30 : 20) : 4;
  }
  if (entry.kind === 'package') total += 6;
  if (entry.exact.includes(query)) total += EXACT_BONUS;
  return total;
}

/**
 * Ranked results. An empty query gives the starter packages. Otherwise every
 * word must occur; results sort by score, then kind, then label, and are never
 * regrouped by kind afterwards, so an exact rule id or name always comes first.
 */
export function searchIndex(index: readonly SearchEntry[], query: string, limit = 40): SearchEntry[] {
  const words = filterWords(query);
  if (words.length === 0) {
    return STARTER.map((starter) => index.find((entry) => entry.kind === 'package' && entry.key === starter.short)).filter(
      (entry): entry is SearchEntry => entry !== undefined,
    );
  }
  const whole = words.join(' ');
  return index
    .map((entry) => ({ entry, score: score(entry, words, whole) }))
    .filter(({ score: s }) => s >= 0)
    .sort(
      (a, b) =>
        b.score - a.score || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.entry.label.localeCompare(b.entry.label),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/**
 * A result line as HTML with every query word of two or more characters
 * marked. Matches are found in the raw text and each piece is escaped
 * afterwards, so a word such as `amp` or `lt` never lands inside an entity.
 */
export function highlightHtml(text: string, words: readonly string[]): string {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    if (word.length < 2) continue;
    const needle = word.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      marked.fill(true, at, at + needle.length);
    }
  }
  let html = '';
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      const piece = escapeHtml(text.slice(start, i));
      html += marked[start] ? `<mark>${piece}</mark>` : piece;
      start = i;
    }
  }
  return html;
}

/**
 * What a key press does to the palette: Ctrl+K or Cmd+K toggles it, `/` opens
 * it unless you are typing in a field, Escape closes it.
 */
export function paletteShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  target: { tagName: string; isContentEditable: boolean } | null,
  open: boolean,
): 'open' | 'close' | null {
  if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey) && !event.altKey) {
    return open ? 'close' : 'open';
  }
  if (event.key === 'Escape') return open ? 'close' : null;
  if (event.key === '/' && !open && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const typing = target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    return typing ? null : 'open';
  }
  return null;
}
