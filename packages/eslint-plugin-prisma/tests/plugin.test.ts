import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import plugin, { configs, rules } from '../src/index';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const README = readFileSync(`${PACKAGE_ROOT}README.md`, 'utf8');
const ruleIds = Object.keys(rules);

describe('plugin shape', () => {
  it('documents every rule, and links it from the README', () => {
    for (const id of ruleIds) {
      expect(existsSync(`${PACKAGE_ROOT}docs/rules/${id}.md`), id).toBe(true);
      expect(README.includes(`./docs/rules/${id}.md`), id).toBe(true);
    }
  });

  it('has no rule doc without a rule behind it', () => {
    const documented = README.match(/\.\/docs\/rules\/([\w-]+)\.md/g) ?? [];
    for (const link of documented) {
      const id = link.replace('./docs/rules/', '').replace('.md', '');
      expect(ruleIds, id).toContain(id);
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
