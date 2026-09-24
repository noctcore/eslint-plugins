/**
 * Deprecation support, proven on a fixture: no real rule is deprecated today,
 * so an in-memory plugin stands in for the first one. It covers reading both
 * shapes of `meta.deprecated`, every surface that renders a deprecation (README
 * row, doc header, site page, `llms.txt`), and the guards in deprecation.ts,
 * which must pass on the real inventory and fail on a broken fixture.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { deprecatedRulesSection } from '../src/lib/deprecations';
import { deprecationProblems } from './deprecation';
import {
  deprecationOf,
  listRuleDocs,
  loadInventory,
  ruleUrl,
  type PackageEntry,
  type RuleEntry,
  type RuleModuleLike,
} from './inventory';
import { applyRuleHeader, deprecationSentence, renderRulesBlock } from './readmes';
import { renderRuleDoc } from './sync';

const NAMESPACE = 'noctcore-fixture';

/** An object-form deprecation, the shape CONTRIBUTING.md recommends. */
const objectForm: RuleModuleLike = {
  meta: {
    deprecated: {
      message: 'It only covered `fetch`; the replacement covers every client.',
      url: 'https://github.com/noctcore/eslint-plugins/pull/1',
      deprecatedSince: '1.4.0',
      availableUntil: '2.0.0',
      replacedBy: [{ rule: { name: 'new-rule', url: ruleUrl('fixture', 'new-rule') } }],
    },
    replacedBy: ['new-rule'],
  },
};

/** The older shape: `deprecated: true` and a list of ids. */
const legacyForm: RuleModuleLike = { meta: { deprecated: true, replacedBy: ['new-rule', 'noctcore-other/thing'] } };

function fixtureRule(name: string, overrides: Partial<RuleEntry> = {}): RuleEntry {
  return {
    name,
    id: `${NAMESPACE}/${name}`,
    description: `Fixture rule \`${name}\`.`,
    recommended: null,
    fixable: false,
    hasSuggestions: false,
    typeInfo: 'none',
    requiresOptions: false,
    deprecated: false,
    replacedBy: [],
    deprecatedSince: null,
    deprecationMessage: null,
    docsUrl: ruleUrl('fixture', name),
    ...overrides,
  };
}

function fixturePackage(rules: RuleEntry[]): PackageEntry {
  return {
    short: 'fixture',
    npmName: '@noctcore/eslint-plugin-fixture',
    kind: 'eslint-plugin',
    namespace: NAMESPACE,
    version: '1.4.0',
    description: 'Fixture plugin.',
    dir: '/repo/packages/eslint-plugin-fixture',
    rules,
  };
}

const oldRule = fixtureRule('old-rule', deprecationOf(objectForm, NAMESPACE));
const newRule = fixtureRule('new-rule', { recommended: 'error' });
const pkg = fixturePackage([newRule, oldRule]);
const DOC = '# `noctcore-fixture/old-rule`\n\n> Summary.\n\n## Why\n\nBecause.\n';
const oldDoc = applyRuleHeader(DOC, pkg, oldRule, 'old-rule.md');

describe('reading meta.deprecated', () => {
  test('the object form gives version, message and qualified replacements', () => {
    expect(deprecationOf(objectForm, NAMESPACE)).toEqual({
      deprecated: true,
      replacedBy: ['noctcore-fixture/new-rule'],
      deprecatedSince: '1.4.0',
      deprecationMessage: 'It only covered `fetch`; the replacement covers every client.',
    });
  });

  test('the legacy boolean and replacedBy list are read too', () => {
    expect(deprecationOf(legacyForm, NAMESPACE)).toEqual({
      deprecated: true,
      replacedBy: ['noctcore-fixture/new-rule', 'noctcore-other/thing'],
      deprecatedSince: null,
      deprecationMessage: null,
    });
  });

  test('a replacement in another noctcore plugin is qualified with its namespace', () => {
    const rule: RuleModuleLike = {
      meta: { deprecated: { replacedBy: [{ plugin: { name: '@noctcore/eslint-plugin-react' }, rule: { name: 'x' } }] } },
    };
    expect(deprecationOf(rule, NAMESPACE).replacedBy).toEqual(['noctcore-react/x']);
  });

  test('a live rule is not deprecated', () => {
    expect(deprecationOf({ meta: {} }, NAMESPACE)).toEqual({
      deprecated: false,
      replacedBy: [],
      deprecatedSince: null,
      deprecationMessage: null,
    });
  });
});

describe('rendering a deprecated rule', () => {
  const sentence =
    '❌ Deprecated since 1.4.0: It only covered `fetch`; the replacement covers every client. ' +
    `Use [\`noctcore-fixture/new-rule\`](${ruleUrl('fixture', 'new-rule')}) instead.`;

  test('the sentence names the version, the message and the replacement', () => {
    expect(deprecationSentence(oldRule)).toBe(sentence);
    expect(deprecationSentence(fixtureRule('bare', { deprecated: true }))).toBe('❌ Deprecated.');
  });

  test('the README row is marked and links the replacement', () => {
    const row = renderRulesBlock(pkg)
      .split('\n')
      .find((line) => line.includes('old-rule'));
    expect(row).toBe(
      `| ❌ [\`old-rule\`](${ruleUrl('fixture', 'old-rule')}) | Fixture rule \`old-rule\`. Replaced by ` +
        `[\`noctcore-fixture/new-rule\`](${ruleUrl('fixture', 'new-rule')}). |  |  |  |  |  |`,
    );
  });

  test('the doc header leads with the sentence', () => {
    expect(oldDoc).toContain(`<!-- begin generated rule header -->\n${sentence}\n\nOpt-in: not in \`recommended\``);
    expect(applyRuleHeader(oldDoc, pkg, oldRule, 'old-rule.md')).toBe(oldDoc);
  });

  test('the site page shows a caution banner and a sidebar badge, with a relative link', () => {
    const page = renderRuleDoc(oldDoc, '/repo/packages/eslint-plugin-fixture/docs/rules/old-rule.md', pkg, oldRule);
    expect(page).toContain(
      ':::caution[Deprecated]\n❌ Deprecated since 1.4.0: It only covered `fetch`; the replacement covers every ' +
        'client. Use [`noctcore-fixture/new-rule`](../../fixture/new-rule/) instead.\n:::',
    );
    expect(page).toContain('  badge:\n    text: Deprecated\n    variant: caution');
    expect(page).not.toContain('<!-- begin generated rule header -->');
  });

  test('a live rule gets no banner and no badge', () => {
    const doc = applyRuleHeader(DOC.replace('old-rule', 'new-rule'), pkg, newRule, 'new-rule.md');
    const page = renderRuleDoc(doc, '/repo/packages/eslint-plugin-fixture/docs/rules/new-rule.md', pkg, newRule);
    expect(page).not.toContain(':::caution');
    expect(page).not.toContain('badge:');
  });

  test('llms.txt lists deprecated rules with their replacement, and nothing when there are none', () => {
    const rules = [
      { id: newRule.id, url: 'https://x/new/', deprecated: false, replacedBy: [] },
      { id: oldRule.id, url: 'https://x/old/', deprecated: true, replacedBy: oldRule.replacedBy },
    ];
    expect(deprecatedRulesSection(rules)).toEqual([
      '## Deprecated rules',
      '',
      '- [noctcore-fixture/old-rule](https://x/old/): deprecated, use [noctcore-fixture/new-rule](https://x/new/) instead',
      '',
    ]);
    expect(deprecatedRulesSection(rules.slice(0, 1))).toEqual([]);
  });
});

describe('deprecation guards', () => {
  test('the real inventory meets the contract', async () => {
    const inventory = await loadInventory('src');
    const docs = new Map(listRuleDocs().map((doc) => [`${doc.short}/${doc.rule}`, readFileSync(doc.path, 'utf8')]));
    expect(deprecationProblems(inventory, docs)).toEqual([]);
  });

  test('a well-formed fixture passes', () => {
    expect(deprecationProblems([pkg], new Map([['fixture/old-rule', oldDoc]]))).toEqual([]);
  });

  test('a deprecated rule in a preset, a dangling replacement and a missing header all fail', () => {
    const broken = fixtureRule('broken', {
      recommended: 'off',
      deprecated: true,
      replacedBy: ['noctcore-fixture/gone', 'noctcore-fixture/old-rule'],
    });
    const problems = deprecationProblems([fixturePackage([newRule, oldRule, broken])], new Map([
      ['fixture/old-rule', oldDoc],
      ['fixture/broken', DOC.replace('old-rule', 'broken')],
    ]));
    expect(problems).toEqual([
      "noctcore-fixture/broken is deprecated but its package's recommended preset lists it (off)",
      'noctcore-fixture/broken is replaced by noctcore-fixture/gone, which is not a rule in this repo',
      'noctcore-fixture/broken is replaced by noctcore-fixture/old-rule, which is deprecated too',
      'noctcore-fixture/broken is deprecated but its doc has no generated deprecation header',
    ]);
  });

  test('a stale deprecation header fails too', () => {
    const renamed = { ...oldRule, deprecatedSince: '1.5.0' };
    expect(deprecationProblems([fixturePackage([newRule, renamed])], new Map([['fixture/old-rule', oldDoc]]))).toEqual([
      'noctcore-fixture/old-rule is deprecated but its doc has no generated deprecation header',
    ]);
  });
});
