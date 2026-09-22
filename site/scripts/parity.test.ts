/**
 * Anti-rot guard: every exported rule has a doc, and every doc has a rule.
 *
 * The docs site renders one page per `packages/*\/docs/rules/*.md` and links
 * every rule's `meta.docs.url` at that page, so a rule without a doc ships a
 * dead link in every consumer's lint output, and a doc without a rule is a page
 * describing something that no longer exists.
 *
 * The ESLint plugins already get a per-plugin version of the first two checks
 * from runPluginDocs in @noctcore/eslint-test-utils. The 21 lint-meta rules get
 * none there, and nothing else counts the whole set, so this guard covers all
 * 97 in one place.
 *
 * EXPECTED_RULE_COUNT is a deliberate tripwire on the inventory itself. The set
 * comparison alone passes if the inventory goes blind (a listing of
 * `src/rules/` finds 93 and misses the 4 lint-meta rules on sub-entry points),
 * so a change to the number must be made by hand, in the same commit that adds
 * or removes a rule and its doc.
 */
import { describe, expect, test } from 'bun:test';

import { listRuleDocs, loadInventory } from './inventory';

const EXPECTED_RULE_COUNT = 97;

// Source, not dist: a rule added and not yet built must still fail here.
const inventory = await loadInventory('src');
const ruleKeys = inventory.flatMap((pkg) => pkg.rules.map((rule) => `${pkg.short}/${rule.name}`));
const docKeys = listRuleDocs().map((doc) => `${doc.short}/${doc.rule}`);

describe('rule/doc parity', () => {
  test('every exported rule has a doc at packages/<pkg>/docs/rules/<rule>.md', () => {
    const docs = new Set(docKeys);
    expect(ruleKeys.filter((key) => !docs.has(key))).toEqual([]);
  });

  test('every doc under packages/<pkg>/docs/rules/ belongs to an exported rule', () => {
    const rules = new Set(ruleKeys);
    expect(docKeys.filter((key) => !rules.has(key))).toEqual([]);
  });

  test(`the inventory sees exactly ${EXPECTED_RULE_COUNT} rules and ${EXPECTED_RULE_COUNT} docs`, () => {
    expect({ rules: ruleKeys.length, docs: docKeys.length }).toEqual({
      rules: EXPECTED_RULE_COUNT,
      docs: EXPECTED_RULE_COUNT,
    });
  });

  test('the 4 lint-meta rules behind sub-entry points are in the inventory', () => {
    const lintMeta = inventory.find((pkg) => pkg.kind === 'lint-meta');
    const subEntry = lintMeta?.rules.filter((rule) => rule.entry !== lintMeta.npmName) ?? [];
    expect(subEntry.map((rule) => rule.name).sort()).toEqual([
      'eslint-config-no-warn',
      'prisma-method-surface',
      'tenant-model-registry-parity',
      'translation-dead-keys',
    ]);
  });

  test('no rule id is exported twice', () => {
    expect(ruleKeys.length).toBe(new Set(ruleKeys).size);
  });
});
