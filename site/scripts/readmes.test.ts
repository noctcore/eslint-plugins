/**
 * Drift guard for the generated README tables and rule-doc headers: regenerate
 * both in memory from the rules' source `meta` and compare with the files on
 * disk. A changed `meta.docs.description`, a rule moved in or out of
 * `recommended`, or a hand edit between the markers fails here until
 * `bun run docs:readmes` is rerun and its output committed.
 */
import { describe, expect, test } from 'bun:test';
import { relative } from 'node:path';

import { REPO_ROOT, loadInventory } from './inventory';
import {
  HEADER_BEGIN,
  HEADER_END,
  RULES_BEGIN,
  applyRuleHeader,
  applyRulesBlock,
  generate,
  stripRuleHeader,
} from './readmes';
import { renderRuleDoc } from './sync';

const files = await generate();
const inventory = await loadInventory('src');

describe('generated README tables and rule-doc headers', () => {
  test('every README and rule doc matches what `bun run docs:readmes` writes', () => {
    const stale = files.filter((file) => file.current !== file.expected).map((file) => relative(REPO_ROOT, file.path));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} file(s) are out of date with the rules' meta. Run \`bun run docs:readmes\` and commit the result:\n  ${stale.join('\n  ')}`,
      );
    }
  });

  test('regenerating is a no-op', () => {
    const pkg = inventory[0]!;
    const rule = pkg.rules[0]!;
    const readme = files.find((file) => file.path.endsWith(`${pkg.dir}/README.md`))!.expected;
    expect(applyRulesBlock(readme, pkg, 'README.md')).toBe(readme);
    const doc = `# \`${rule.id}\`\n\n> Summary.\n\n## Why\n\nBecause.\n`;
    const once = applyRuleHeader(doc, pkg, rule, 'doc.md');
    expect(applyRuleHeader(once, pkg, rule, 'doc.md')).toBe(once);
    expect(stripRuleHeader(once)).toBe(doc);
  });

  test('every plugin README table has the same columns', () => {
    const headers = new Set(
      inventory
        .filter((pkg) => pkg.kind === 'eslint-plugin')
        .map((pkg) => {
          const readme = files.find((file) => file.path.endsWith(`${pkg.dir}/README.md`))!.expected;
          return readme.slice(readme.indexOf(RULES_BEGIN)).split('\n').find((line) => line.startsWith('| Rule'));
        }),
    );
    expect([...headers]).toEqual(['| Rule | Description | ✅ | ⚙️ | 🔧 | 💡 | 💭 |']);
  });

  test('the site page drops the doc header and keeps its own metadata line', () => {
    const pkg = inventory.find((entry) => entry.kind === 'eslint-plugin')!;
    const rule = pkg.rules[0]!;
    const sections = ['Why', 'What it flags', 'What it does not flag', 'When not to use it'];
    if (rule.hasOptions) sections.splice(3, 0, 'Options');
    const body = sections.map((section) => `## ${section}\n\nText.\n`).join('\n');
    const doc = applyRuleHeader(`# \`${rule.id}\`\n\n> Summary.\n\n${body}`, pkg, rule, 'doc.md');
    const page = renderRuleDoc(doc, `${pkg.dir}/docs/rules/${rule.name}.md`, pkg, rule);
    expect(page).not.toContain(HEADER_BEGIN);
    expect(page).not.toContain(HEADER_END);
    expect(page).toContain('**Recommended preset:**');
  });
});
