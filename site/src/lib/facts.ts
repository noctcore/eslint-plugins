/**
 * The facts panel every rule page carries: a copyable rule id, then the same
 * cells in the same order on every page, a chip where a value is a state and
 * plain text for a yes or no, `is-no` on a negative so it reads quieter.
 *
 * Pure and structural, so the generated catalog's rules, the inventory's
 * rules and the test fixtures all fit. RuleFacts.astro renders it in the
 * right column on wide screens and under the title below 72rem.
 */
import { escapeHtml } from './format';
import { glyphSvg } from './glyphs';

export interface FactsPackage {
  readonly short: string;
  readonly kind: string;
  readonly version: string;
}

export interface FactsRule {
  readonly id: string;
  readonly recommended: string | null;
  readonly strict: string | null;
  readonly fixable: boolean;
  readonly hasSuggestions: boolean;
  readonly typeInfo: string;
  readonly requiresOptions: boolean;
  readonly hasOptions: boolean;
  readonly deprecated: boolean;
  readonly factory?: string | undefined;
  readonly entry?: string | undefined;
  readonly category?: string | undefined;
  readonly ciCritical?: boolean | undefined;
}

/** One cell. `quiet` marks a negative value. */
function fact(label: string, value: string, quiet = false): string {
  return `  <div><dt>${label}</dt><dd${quiet ? ' class="is-no"' : ''}>${value}</dd></div>`;
}

const chip = (kind: string, text: string) => `<span class="chip chip-${kind}">${text}</span>`;
const yesNo = (label: string, yes: boolean, yesText = 'Yes') => fact(label, yes ? yesText : 'No', !yes);

/** Which preset turns the rule on: recommended, strict only (the house rules), or none. */
function presetCell(rule: FactsRule): string {
  if (rule.recommended === 'error') return fact('Preset', 'recommended');
  if (rule.strict === 'error') return fact('Preset', 'strict');
  // A deprecated rule is in no preset on purpose; it is not one to turn on.
  return fact('Preset', rule.deprecated ? 'none' : `none ${chip('opt', 'opt-in')}`, true);
}

function severityCell(rule: FactsRule): string {
  const on = rule.recommended === 'error' || rule.strict === 'error';
  return fact('Severity', on ? chip('error', 'error') : chip('off', 'off'));
}

function ruleId(id: string): string {
  const safe = escapeHtml(id);
  return [
    '<div class="rule-id">',
    '  <span class="rule-id-label">Rule id</span>',
    `  <button type="button" class="copy-btn" data-copy-text="${safe}" aria-label="Copy rule id">` +
      `${glyphSvg('copy', 15)}<span class="cl">Copy</span></button>`,
    `  <code>${safe}</code>`,
    '</div>',
  ].join('\n');
}

export function factsPanel(pkg: FactsPackage, rule: FactsRule, base: string): string {
  const packageLink = `<a href="${base}/packages/${pkg.short}/">${pkg.short}</a> <span class="facts-note">v${pkg.version}</span>`;
  let cells: string[];
  if (pkg.kind === 'lint-meta') {
    // A reader who lands here from search has no other route to what runs a
    // lint-meta rule: not ESLint, the harness. The package page explains it.
    cells = [
      fact('Package', packageLink),
      fact('Runs under', '<code>@noctcore/harness</code> lint-meta, not ESLint'),
      fact('Factory', `<code>${escapeHtml(rule.factory ?? '')}</code>`),
      fact('Entry point', `<code>${escapeHtml(rule.entry ?? '')}</code>`),
      fact('Category', `<code>${escapeHtml(rule.category ?? '')}</code>`),
      yesNo('Fails CI by default', rule.ciCritical === true),
    ];
  } else {
    const options = rule.requiresOptions
      ? fact('Options', chip('options', 'Required'))
      : fact('Options', rule.hasOptions ? 'Optional' : 'None', !rule.hasOptions);
    const typeInfo =
      rule.typeInfo === 'none' ? fact('Type info', 'Not needed', true) : fact('Type info', chip('types', rule.typeInfo));
    cells = [
      fact('Package', packageLink),
      presetCell(rule),
      severityCell(rule),
      yesNo('Autofix', rule.fixable, '<code>--fix</code>'),
      yesNo('Suggestions', rule.hasSuggestions),
      options,
      typeInfo,
    ];
  }
  if (rule.deprecated) cells.push(fact('Status', chip('deprecated', 'deprecated')));
  return ['<div class="rule-facts">', ruleId(rule.id), '<dl class="facts-list">', ...cells, '</dl>', '</div>'].join('\n');
}
