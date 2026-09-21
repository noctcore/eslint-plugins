import { afterEach, describe, expect, test } from 'bun:test';

import type { IViolation } from '@noctcore/harness';

import { createEslintConfigNoWarnRule } from '../../src/resolved-config';
import { createNoWarnSeverityRule } from '../../src/rules';
import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';
import { cleanupTrees, eslintConfigSource, realTreeCtx } from '../test-utils/writeTree';

afterEach(cleanupTrees);

const ruleIn = (violation: IViolation): string | undefined =>
  /Rule "([^"]+)"/u.exec(violation.message)?.[1];

async function check(
  files: Record<string, string>,
  options: Parameters<typeof createEslintConfigNoWarnRule>[0] = {},
): Promise<IViolation[]> {
  const rule = createEslintConfigNoWarnRule(options);
  return (await rule.runAsync?.(realTreeCtx(files))) ?? [];
}

/*
 * A preset module that ships a rule at `warn`, spread into a config that holds
 * no `warn` literal of its own: the case a text scan cannot see. The stub plugin
 * declares the preset's rule (at `off`) so ESLint accepts the id.
 */
const PRESET = `export const preset = { rules: { 'demo/from-preset': 1 } };\n`;
const withPreset = (rules: Record<string, unknown>, after = ''): string =>
  eslintConfigSource({ 'demo/from-preset': 'off', ...rules })
    .replace('export default [', "import { preset } from './preset.mjs';\nexport default [")
    .replace(/\n\];\n$/u, `\n  { files: ['**/*.ts'], rules: preset.rules },${after}\n];\n`);
const PRESET_FILES = {
  'packages/ui/eslint.config.mjs': withPreset({ 'demo/own': 'error' }),
  'packages/ui/preset.mjs': PRESET,
};

describe('eslint-config-no-warn', () => {
  test('reports a rule that resolves to warn, whatever spelling set it', async () => {
    const violations = await check({
      'apps/web/eslint.config.mjs': eslintConfigSource({
        'demo/numeric-warn': 1,
        'demo/string-warn': 'warn',
        'demo/array-warn': ['warn', { max: 3 }],
      }),
    });

    expect(violations.map(ruleIn)).toEqual(['demo/array-warn', 'demo/numeric-warn', 'demo/string-warn']);
    for (const violation of violations) {
      expect(violation.rule).toBe('eslint-config-no-warn');
      expect(violation.file).toBe('apps/web/eslint.config.mjs');
      expect(violation.message).toMatch(/resolves to "warn" in "apps\/web"/u);
    }
  });

  test('passes a config whose rules are only error or off', async () => {
    expect(
      await check({
        'apps/web/eslint.config.mjs': eslintConfigSource({
          'demo/on': 'error',
          'demo/on-numeric': 2,
          'demo/on-array': ['error', { max: 3 }],
          'demo/off': 'off',
          'demo/off-numeric': 0,
        }),
      }),
    ).toEqual([]);
  });

  test('catches a warn a spread preset injects, which the text scan passes', async () => {
    expect((await check(PRESET_FILES)).map(ruleIn)).toEqual(['demo/from-preset']);

    // The literal scan reads the config text, finds no `warn`, and passes it.
    expect(
      createNoWarnSeverityRule({ configFiles: ['packages/ui/eslint.config.mjs'] }).run?.(
        realTreeCtx(PRESET_FILES),
      ),
    ).toEqual([]);
  });

  test('a later override to error clears a preset warn', async () => {
    const violations = await check({
      'packages/ui/eslint.config.mjs': withPreset(
        {},
        "\n  { files: ['**/*.ts'], rules: { 'demo/from-preset': 'error' } },",
      ),
      'packages/ui/preset.mjs': PRESET,
    });
    expect(violations).toEqual([]);
  });

  test('checks every package that owns a config, the root included, and reports the one at fault', async () => {
    const violations = await check({
      'eslint.config.mjs': eslintConfigSource({ 'demo/root': 'warn' }),
      'apps/api/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'error' }),
      'packages/ui/eslint.config.js': eslintConfigSource({ 'demo/b': 'warn' }),
    });

    expect(violations.map((v) => [v.file, ruleIn(v)])).toEqual([
      ['eslint.config.mjs', 'demo/root'],
      ['packages/ui/eslint.config.js', 'demo/b'],
    ]);
  });

  test('a test-file-scoped block is reached through the test probes', async () => {
    const violations = await check({
      'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'error' }).replace(
        /\n\];\n$/u,
        "\n  { files: ['**/*.test.ts'], rules: { 'demo/a': 'warn' } },\n];\n",
      ),
    });
    expect(violations.map(ruleIn)).toEqual(['demo/a']);
  });

  test('packages, configFiles and probes are options', async () => {
    const files = {
      'services/billing/lint.config.mjs': 'export default [];\n',
      'services/billing/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'error' }).replace(
        "files: ['**/*.ts', '**/*.tsx']",
        "files: ['lib/**/*.js']",
      ).replace('"error"', '"warn"'),
    };

    // The defaults look in neither `services/*` nor at `.js` probes.
    expect(await check(files)).toEqual([]);
    const violations = await check(files, {
      id: 'no-warn-services',
      packages: ['services/*'],
      configFiles: ['eslint.config.mjs'],
      probes: ['lib/probe.js'],
    });
    expect(violations.map((v) => [v.rule, ruleIn(v)])).toEqual([['no-warn-services', 'demo/a']]);
  });

  test('ignores a package with no eslint config of its own', async () => {
    expect(await check({ 'apps/api/package.json': '{}' })).toEqual([]);
  });

  test('fails closed when the config cannot be resolved at all', async () => {
    const violations = await check({
      'apps/web/eslint.config.mjs': "import 'this-package-does-not-exist-anywhere';\nexport default [];\n",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('apps/web/eslint.config.mjs');
    expect(violations[0]?.message).toMatch(/Could not resolve the effective ESLint config for "apps\/web"/u);
  });

  test('fails closed when one probe throws, even though another resolves', async () => {
    // The `.ts`-only block names a rule the plugin lacks, so only `.ts` probes
    // throw; the `.tsx` probes still resolve, and must not hide the failure.
    const violations = await check({
      'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'error' }).replace(
        /\n\];\n$/u,
        "\n  { files: ['**/*.ts'], rules: { 'demo/missing': 'error' } },\n];\n",
      ),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/resolving "src\/__lint_meta_probe__\.ts".*demo\/missing|missing/u);
  });

  test('fails closed when the config ignores every probe', async () => {
    const violations = await check({
      'apps/web/eslint.config.mjs': "export default [{ ignores: ['src/**'] }];\n",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/is ignored by the config/u);
  });

  test('is async-only: it declares runAsync and no sync run', () => {
    const rule = createEslintConfigNoWarnRule();
    expect(rule.id).toBe('eslint-config-no-warn');
    expect(rule.ciCritical).toBe(true);
    expect(typeof rule.runAsync).toBe('function');
    expect(rule.run).toBeUndefined();
  });
});

describe('eslint-config-no-warn through the real harness', () => {
  const files = {
    ...PRESET_FILES,
    'apps/api/eslint.config.mjs': eslintConfigSource({ 'demo/b': 'error' }),
  };
  const expected = ['eslint-config-no-warn (packages/ui/eslint.config.mjs): Rule "demo/from-preset"'];
  const summarise = (lines: readonly string[]): string[] => lines.map((line) => line.split(' resolves')[0] ?? line);

  test('under Bun, from source', () => {
    const run = runLintMetaOnRealTree(files, 'createEslintConfigNoWarnRule');
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);

  test('under Node with ESLint 9.0.0 (the peer floor), from the built package', () => {
    const run = runLintMetaOnRealTree(files, 'createEslintConfigNoWarnRule', {}, { runtime: 'node-eslint9' });
    expect(run.stdout).toMatch(/^eslint 9\.0\.0$/mu);
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);
});
