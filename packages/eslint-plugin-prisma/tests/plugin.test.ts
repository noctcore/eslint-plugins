import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import plugin, { configs, rules } from '../src/index';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ruleIds = Object.keys(rules);

describe('plugin shape', () => {
  // The README rules table is generated from the plugin's meta and checked by
  // site/scripts/readmes.test.ts, so only the doc file is asserted here.
  it('documents every rule', () => {
    for (const id of ruleIds) {
      expect(existsSync(`${PACKAGE_ROOT}docs/rules/${id}.md`), id).toBe(true);
    }
  });

  it('points recommended only at rules the plugin has', () => {
    const recommended = configs.recommended as { rules: Record<string, string> };
    for (const key of Object.keys(recommended.rules)) {
      expect(key.startsWith('noctcore-prisma/'), key).toBe(true);
      expect(ruleIds, key).toContain(key.replace('noctcore-prisma/', ''));
    }
  });

  it('names no consumer domain in any rule message or description', () => {
    // The rules ship a pattern, not one project's business: the worked example
    // lives in docs, never in what a user sees when a rule fires.
    const banned = /firma|eteczka|obieg|pracownik|kadry|biuro|settly/iu;
    for (const [id, rule] of Object.entries(plugin.rules)) {
      const text = JSON.stringify(rule.meta.messages) + rule.meta.docs.description;
      expect(banned.test(text), id).toBe(false);
    }
  });
});
