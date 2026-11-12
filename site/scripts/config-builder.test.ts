/**
 * The package page's config builder (src/lib/config-builder.ts) and header
 * data (src/lib/package-page.ts), on the real inventory. The catalog is built
 * here from source, as sync.ts builds it, because CI's test job runs no sync.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  configText,
  defaultPreset,
  installCommand,
  OPTIONS_PLACEHOLDER,
  presetSeverity,
  presetsOffered,
  type BuilderPackage,
} from '../src/lib/config-builder';
import { badFitLine, presetCounts } from '../src/lib/package-page';
import { loadInventory } from './inventory';
import { catalogOf } from './sync';

const catalog = catalogOf(await loadInventory('src'));
const pkg = (short: string): BuilderPackage => {
  const found = catalog.find((entry) => entry.short === short);
  if (!found) throw new Error(`no package ${short}`);
  return found;
};
const security = pkg('security');
const react = pkg('react');
const contracts = pkg('contracts');
const lintMeta = pkg('lint-meta-rules');

const PACKAGE_PAGES = join(import.meta.dir, '..', 'src', 'content', 'docs', 'packages');

describe('config text', () => {
  test('security with recommended and no overrides is the base snippet', () => {
    expect(configText(security, 'recommended', {})).toBe(
      [
        '// eslint.config.js',
        "import tsParser from '@typescript-eslint/parser';",
        "import security from '@noctcore/eslint-plugin-security';",
        '',
        'export default [',
        '  {',
        '    ...security.configs.recommended,',
        "    files: ['**/*.{ts,tsx}'],",
        '    languageOptions: { parser: tsParser },',
        '  },',
        '];',
      ].join('\n'),
    );
  });

  test('react strict with one house rule switched off prints one rules line', () => {
    expect(configText(react, 'strict', { 'component-props-naming': 'off' })).toBe(
      [
        '// eslint.config.js',
        "import tsParser from '@typescript-eslint/parser';",
        "import react from '@noctcore/eslint-plugin-react';",
        '',
        'export default [',
        '  {',
        '    ...react.configs.strict,',
        "    files: ['**/*.{ts,tsx}'],",
        '    languageOptions: { parser: tsParser },',
        '    rules: {',
        "      'noctcore-react/component-props-naming': 'off',",
        '    },',
        '  },',
        '];',
      ].join('\n'),
    );
  });

  test('a hyphenated short name imports under its camel-case name', () => {
    expect(configText(pkg('code-quality'), 'recommended', {})).toContain(
      "import codeQuality from '@noctcore/eslint-plugin-code-quality';",
    );
  });

  test('a requiresOptions rule switched on gets the options placeholder', () => {
    const rule = contracts.rules.find((candidate) => candidate.requiresOptions);
    if (!rule) throw new Error('contracts has no rule that requires options');
    expect(presetSeverity(rule, 'recommended')).toBe('off');
    const text = configText(contracts, 'recommended', { [rule.name]: 'error' });
    expect(text).toContain(`      '${rule.id}': ${OPTIONS_PLACEHOLDER},`);
    expect(OPTIONS_PLACEHOLDER).toBe("['error', { /* see the rule's Options */ }]");
  });

  test('preset none registers the plugin and lists only error overrides', () => {
    const [first, second] = security.rules;
    const text = configText(security, 'none', { [first!.name]: 'error', [second!.name]: 'off' });
    expect(text).toBe(
      [
        '// eslint.config.js',
        "import tsParser from '@typescript-eslint/parser';",
        "import security from '@noctcore/eslint-plugin-security';",
        '',
        'export default [',
        '  {',
        "    plugins: { 'noctcore-security': security },",
        "    files: ['**/*.{ts,tsx}'],",
        '    languageOptions: { parser: tsParser },',
        '    rules: {',
        `      '${first!.id}': ${first!.requiresOptions ? OPTIONS_PLACEHOLDER : "'error'"},`,
        '    },',
        '  },',
        '];',
      ].join('\n'),
    );
    expect(text).not.toContain('.configs.');
  });

  test('an override equal to the preset severity is not printed', () => {
    const on = security.rules.find((rule) => rule.recommended === 'error')!;
    const off = security.rules.find((rule) => rule.recommended !== 'error')!;
    expect(configText(security, 'recommended', { [on.name]: 'error', [off.name]: 'off' })).toBe(
      configText(security, 'recommended', {}),
    );
  });

  test('rule lines follow the package rule order, not the order the overrides were made in', () => {
    const [a, b] = react.rules.filter((rule) => rule.strict === 'error');
    const text = configText(react, 'strict', { [b!.name]: 'off', [a!.name]: 'off' });
    expect(text.indexOf(a!.id)).toBeGreaterThan(-1);
    expect(text.indexOf(a!.id)).toBeLessThan(text.indexOf(b!.id));
  });

  test('strict is offered exactly for architecture, code-quality, contracts and react', () => {
    const withStrict = catalog
      .filter((entry) => entry.kind === 'eslint-plugin' && presetsOffered(entry).includes('strict'))
      .map((entry) => entry.short)
      .sort();
    expect(withStrict).toEqual(['architecture', 'code-quality', 'contracts', 'react']);
    expect(presetsOffered(security)).toEqual(['recommended', 'none']);
    expect(presetsOffered(react)).toEqual(['recommended', 'strict', 'none']);
    expect(() => configText(security, 'strict', {})).toThrow('has no "strict" preset');
    expect(() => configText(lintMeta, 'recommended', {})).toThrow('not an ESLint plugin');
  });

  test('the board starts from strict only where recommended enables nothing and strict does', () => {
    expect(defaultPreset(pkg('architecture'))).toBe('strict');
    expect(defaultPreset(react)).toBe('recommended');
    expect(defaultPreset(pkg('monorepo'))).toBe('recommended');
    for (const entry of catalog.filter((candidate) => candidate.kind === 'eslint-plugin')) {
      expect(presetsOffered(entry)).toContain(defaultPreset(entry));
    }
  });

  test('install adds the parser for a plugin and nothing for the lint-meta catalog', () => {
    expect(installCommand(security)).toBe(
      'npm install --save-dev @noctcore/eslint-plugin-security @typescript-eslint/parser\n' +
        '# or: bun add -D / pnpm add -D @noctcore/eslint-plugin-security @typescript-eslint/parser',
    );
    expect(installCommand(lintMeta).split('\n')[0]).toBe('npm install --save-dev @noctcore/lint-meta-rules');
  });
});

describe('package page header', () => {
  test('every package page yields a not-a-good-fit line', () => {
    const pages = readdirSync(PACKAGE_PAGES).filter((name) => name.endsWith('.mdx'));
    expect(pages.length).toBe(catalog.length);
    for (const page of pages) {
      const line = badFitLine(readFileSync(join(PACKAGE_PAGES, page), 'utf8'));
      expect(line.length).toBeGreaterThan(10);
      expect(line.endsWith('.')).toBe(false);
    }
  });

  test('a dot inside a code span does not end the line', () => {
    expect(badFitLine('x **It is a bad fit** for `utils.x.invalidate()` users. More.')).toBe('for `utils.x.invalidate()` users');
    expect(badFitLine('**It is a bad fit** if `package.json` is missing.\nNext')).toBe('if `package.json` is missing');
  });

  test('a body without the marker throws', () => {
    expect(() => badFitLine('A page that never says where it does not fit.')).toThrow('bad fit');
  });

  test('preset counts split every live rule into recommended, strict only and opt-in', () => {
    for (const entry of catalog.filter((candidate) => candidate.kind === 'eslint-plugin')) {
      const counts = presetCounts(entry);
      const live = entry.rules.filter((rule) => !rule.deprecated).length;
      expect(counts.recommended + counts.strictOnly + counts.optIn).toBe(live);
    }
    const strictOnly = presetCounts(react).strictOnly;
    expect(strictOnly).toBeGreaterThan(0);
    expect(presetCounts(security).strictOnly).toBe(0);
  });
});
