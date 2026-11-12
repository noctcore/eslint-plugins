/**
 * The All rules page's filter: text, preset and capability toggles over every
 * rule in the catalog. Pure, so the page's client script and
 * scripts/rule-filters.test.ts run the same function; it takes catalog-shaped
 * data and never imports the generated catalog.
 */
import { presetLabel } from './format';

export type PresetFilter = 'all' | 'recommended' | 'strict' | 'opt-in';

export interface RuleFilter {
  readonly text: string;
  readonly preset: PresetFilter;
  readonly fix: boolean;
  readonly types: boolean;
}

export const EMPTY_FILTER: RuleFilter = { text: '', preset: 'all', fix: false, types: false };

export interface FilterRow {
  readonly key: string;
  readonly short: string;
  readonly kind: string;
  readonly name: string;
  readonly id: string;
  readonly description: string;
  readonly recommended: string | null;
  readonly strict: string | null;
  readonly fixable: boolean;
  readonly typeInfo: string;
  readonly deprecated: boolean;
}

type CatalogRuleLike = Omit<FilterRow, 'key' | 'short' | 'kind'>;

/** One row per rule and lint-meta check, in catalog order, keyed `<short>/<name>`. */
export function ruleRows(
  catalog: readonly { short: string; kind: string; rules: readonly CatalogRuleLike[] }[],
): FilterRow[] {
  return catalog.flatMap((pkg) =>
    pkg.rules.map((rule) => ({
      key: `${pkg.short}/${rule.name}`,
      short: pkg.short,
      kind: pkg.kind,
      name: rule.name,
      id: rule.id,
      description: rule.description,
      recommended: rule.recommended,
      strict: rule.strict,
      fixable: rule.fixable,
      typeInfo: rule.typeInfo,
      deprecated: rule.deprecated,
    })),
  );
}

function presetMatches(row: FilterRow, preset: PresetFilter): boolean {
  if (preset === 'all') return true;
  if (row.kind !== 'eslint-plugin') return false;
  const label = presetLabel(row);
  if (preset === 'recommended') return label === 'error';
  if (preset === 'strict') return label === 'strict';
  return label === 'off' || label === 'not listed';
}

/** The words of a text filter: lowercased, split on whitespace, empty words dropped. */
export function filterWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

export function filterRules(rows: readonly FilterRow[], filter: RuleFilter): FilterRow[] {
  const words = filterWords(filter.text);
  return rows.filter((row) => {
    if (!presetMatches(row, filter.preset)) return false;
    if (filter.fix && !row.fixable) return false;
    if (filter.types && row.typeInfo === 'none') return false;
    if (words.length === 0) return true;
    const hay = `${row.name} ${row.id} ${row.description} ${row.short}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}
