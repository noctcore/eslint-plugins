/**
 * Every package README follows its skeleton and every rule doc follows the
 * rule-doc template (`structure.ts`). The negative cases pin that a moved or
 * renamed heading fails, so the checks cannot quietly pass everything.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { REPO_ROOT, listRuleDocs, loadInventory } from './inventory';
import { checkReadmeSections, checkRuleDocSections, h2Headings } from './structure';

const inventory = await loadInventory('src');

function failures(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('package README skeleton', () => {
  test('every package README has its skeleton sections, in order', () => {
    const broken = inventory.flatMap((pkg) => {
      const path = join(pkg.dir, 'README.md');
      const message = failures(() => checkReadmeSections(readFileSync(path, 'utf8'), relative(REPO_ROOT, path), pkg));
      return message ? [message] : [];
    });
    expect(broken).toEqual([]);
  });

  test('a moved or renamed README section fails', () => {
    const pkg = inventory.find((entry) => entry.short === 'security')!;
    const readme = readFileSync(join(pkg.dir, 'README.md'), 'utf8');
    const swapped = readme.replace('## Install', '## TMP').replace('## Quick start', '## Install').replace('## TMP', '## Quick start');
    expect(failures(() => checkReadmeSections(swapped, 'README.md', pkg))).toContain('expected');
    const renamed = readme.replace('## Quick start', '## Use');
    expect(failures(() => checkReadmeSections(renamed, 'README.md', pkg))).toContain('unknown section(s) "## Use"');
    const dropped = readme.replace(/## Opt-in rules[\s\S]*?(?=## Rules)/, '');
    expect(failures(() => checkReadmeSections(dropped, 'README.md', pkg))).toContain('"## Opt-in rules"');
  });
});

describe('rule-doc template', () => {
  test('every rule doc has the template sections, in order', () => {
    const broken = listRuleDocs().flatMap((doc) => {
      const rule = inventory.find((pkg) => pkg.short === doc.short)?.rules.find((entry) => entry.name === doc.rule);
      if (!rule) return [`${doc.path}: no rule`];
      const message = failures(() => checkRuleDocSections(readFileSync(doc.path, 'utf8'), relative(REPO_ROOT, doc.path), rule));
      return message ? [message] : [];
    });
    expect(broken).toEqual([]);
  });

  const withOptions = inventory.flatMap((pkg) => pkg.rules).find((rule) => rule.hasOptions)!;
  const doc = ['Why', 'What it flags', 'What it does not flag', 'Options', 'When not to use it']
    .map((section) => `## ${section}\n\nText.\n`)
    .join('\n');

  test('the template itself passes, fences are skipped and Related and Credits are optional', () => {
    const fenced = `${doc}\n\`\`\`md\n## Not a heading\n\`\`\`\n\n## Related\n\nText.\n\n## Credits\n\nMIT.\n`;
    expect(h2Headings(fenced)).not.toContain('Not a heading');
    expect(failures(() => checkRuleDocSections(doc, 'doc.md', withOptions))).toBeNull();
    expect(failures(() => checkRuleDocSections(fenced, 'doc.md', withOptions))).toBeNull();
  });

  test('a moved, renamed, missing or extra rule-doc section fails', () => {
    const moved = doc.replace('## Why', '## TMP').replace('## What it flags', '## Why').replace('## TMP', '## What it flags');
    expect(failures(() => checkRuleDocSections(moved, 'doc.md', withOptions))).toContain('expected');
    const renamed = doc.replace('## What it does not flag', '## Limits');
    expect(failures(() => checkRuleDocSections(renamed, 'doc.md', withOptions))).toContain('unknown section(s) "## Limits"');
    const noOptions = doc.replace('## Options\n\nText.\n', '');
    expect(failures(() => checkRuleDocSections(noOptions, 'doc.md', withOptions))).toContain('"## Options"');
    const optionless = { ...withOptions, hasOptions: false };
    expect(failures(() => checkRuleDocSections(doc, 'doc.md', optionless))).toContain('expected');
    expect(failures(() => checkRuleDocSections(noOptions, 'doc.md', optionless))).toBeNull();
  });
});
