/**
 * The shape every package README and rule doc keeps, so a reader finds the
 * same thing in the same place on every page. `sync.ts` checks each rule doc
 * while rendering it, which fails `bun run docs:build`; `structure.test.ts`
 * checks every README and rule doc under `bun run test`. CONTRIBUTING.md
 * describes both templates.
 */
import type { PackageEntry, RuleEntry } from './inventory';

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
  const hasOptIn = pkg.rules.some((rule) => rule.recommended !== 'error' || rule.requiresOptions);
  expectSections(
    headings,
    PLUGIN_README_SECTIONS,
    (section) => {
      if (section === 'Opt-in rules') return hasOptIn;
      if (section === 'Credits') return headings.includes(section);
      return true;
    },
    path,
    'README',
  );
}
