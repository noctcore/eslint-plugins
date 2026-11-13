import { afterEach, describe, expect, test } from 'bun:test';

import type { IViolation } from '@noctcore/harness';

import { createEslintRulesNotWeakenedRule, type PinnedRule } from '../../src/resolved-config';
import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';
import { cleanupTrees, eslintConfigSource, realTreeCtx } from '../test-utils/writeTree';

afterEach(cleanupTrees);

const RULE = '@typescript-eslint/consistent-type-assertions';
const PIN: Record<string, PinnedRule> = { [RULE]: ['error', { assertionStyle: 'never' }] };

const ruleIn = (violation: IViolation): string | undefined =>
  /Rule "([^"]+)"/u.exec(violation.message)?.[1];
const probeIn = (violation: IViolation): string | undefined =>
  /probe "([^"]+)"/u.exec(violation.message)?.[1];

async function check(
  files: Record<string, string>,
  options: Parameters<typeof createEslintRulesNotWeakenedRule>[0] = {},
): Promise<IViolation[]> {
  const rule = createEslintRulesNotWeakenedRule(options);
  return (await rule.runAsync?.(realTreeCtx(files))) ?? [];
}

/** `source` with `block` appended as the config's last entry. */
const appendBlock = (source: string, block: string): string =>
  source.replace(/\n\];\n$/u, `\n  ${block},\n];\n`);

/*
 * A preset module that sets the pinned rule, spread into a config whose own text
 * never names its options: the case a text scan cannot see. The stub plugin
 * declares the rule (at `off`) so ESLint accepts the id.
 */
const presetSource = (entry: unknown): string =>
  `export const preset = { rules: { ${JSON.stringify(RULE)}: ${JSON.stringify(entry)} } };\n`;
const withPreset = (entry: unknown): Record<string, string> => ({
  'packages/ui/eslint.config.mjs': appendBlock(
    eslintConfigSource({ [RULE]: 'off' }).replace(
      'export default [',
      "import { preset } from './preset.mjs';\nexport default [",
    ),
    "{ files: ['**/*.ts', '**/*.tsx'], rules: preset.rules }",
  ),
  'packages/ui/preset.mjs': presetSource(entry),
});

describe('eslint-rules-not-weakened', () => {
  test('catches a pinned option a spread preset weakens', async () => {
    const files = withPreset(['error', { assertionStyle: 'as' }]);
    const violations = await check(files, { pinned: PIN });

    expect(violations.map(probeIn)).toEqual([
      'src/__lint_meta_probe__.ts',
      'src/__lint_meta_probe__.tsx',
      'src/__lint_meta_probe__.test.ts',
      'src/__lint_meta_probe__.test.tsx',
    ]);
    for (const violation of violations) {
      expect(violation.file).toBe('packages/ui/eslint.config.mjs');
      expect(violation.rule).toBe('eslint-rules-not-weakened');
      expect(ruleIn(violation)).toBe(RULE);
      expect(violation.message).toContain('"assertionStyle" is "as", pinned "never"');
      expect(violation.message).toContain('in "packages/ui"');
    }

    expect(await check(files, { pinned: { [RULE]: ['error', { assertionStyle: 'as' }] } })).toEqual([]);
    expect(await check(withPreset(['error', { assertionStyle: 'never' }]), { pinned: PIN })).toEqual([]);
  });

  test('reports a pinned rule that is off, absent or below its pinned severity', async () => {
    const probes = ['src/a.ts', 'src/b.ts'];
    const config = (rules: Record<string, unknown>): Record<string, string> => ({
      'apps/web/eslint.config.mjs': eslintConfigSource(rules),
    });

    const off = await check(config({ 'demo/pinned': 'off' }), { pinned: { 'demo/pinned': 'error' }, probes });
    expect(off.map(probeIn)).toEqual(probes);
    for (const violation of off) expect(violation.message).toContain('"demo/pinned" is off');

    const absent = await check(config({ 'demo/other': 'error' }), { pinned: { 'demo/pinned': 'error' }, probes });
    expect(absent.map(probeIn)).toEqual(probes);
    for (const violation of absent) expect(violation.message).toContain('"demo/pinned" is absent');

    const warned = await check(config({ 'demo/pinned': 'warn' }), { pinned: { 'demo/pinned': 'error' }, probes });
    expect(warned.map(probeIn)).toEqual(probes);
    for (const violation of warned) {
      expect(violation.message).toContain('resolves to "warn", below the pinned "error"');
    }

    expect(await check(config({ 'demo/pinned': 'error' }), { pinned: { 'demo/pinned': 'warn' }, probes })).toEqual([]);
    expect(await check(config({ 'demo/pinned': 2 }), { pinned: { 'demo/pinned': 2 }, probes })).toEqual([]);
    expect(await check(config({ 'demo/pinned': 'warn' }), { pinned: { 'demo/pinned': 1 }, probes })).toEqual([]);
  });

  test('compares only the option keys the pin lists', async () => {
    const probes = ['src/a.ts'];
    const config = (entry: unknown): Record<string, string> => ({
      'apps/web/eslint.config.mjs': eslintConfigSource({ [RULE]: entry }),
    });

    expect(
      await check(config(['error', { assertionStyle: 'never', objectLiteralTypeAssertions: 'allow' }]), {
        pinned: PIN,
        probes,
      }),
    ).toEqual([]);

    const differing = await check(config(['error', { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' }]), {
      pinned: PIN,
      probes,
    });
    expect(differing).toHaveLength(1);
    expect(differing[0]?.message).toContain('"assertionStyle" is "as", pinned "never"');
    expect(differing[0]?.message).not.toContain('objectLiteralTypeAssertions');

    const bare = await check(config('error'), { pinned: PIN, probes });
    expect(bare).toHaveLength(1);
    expect(bare[0]?.message).toContain('"assertionStyle" is unset, pinned "never"');

    const deepPin: Record<string, PinnedRule> = { 'demo/deep': ['error', { allow: ['a'], nested: { on: true } }] };
    const deep = (value: unknown): Record<string, string> => ({
      'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/deep': ['error', value] }),
    });
    expect(await check(deep({ allow: ['a'], nested: { on: true } }), { pinned: deepPin, probes })).toEqual([]);
    const deepDiffering = await check(deep({ allow: ['b'], nested: { on: true } }), { pinned: deepPin, probes });
    expect(deepDiffering).toHaveLength(1);
    expect(deepDiffering[0]?.message).toContain('"allow" is ["b"], pinned ["a"]');
    expect(deepDiffering[0]?.message).not.toContain('"nested" is');
  });

  test('skips a probe matched by exemptProbes', async () => {
    const testsOff = {
      'apps/web/eslint.config.mjs': appendBlock(
        eslintConfigSource({ 'demo/a': 'error' }),
        "{ files: ['**/*.test.ts'], rules: { 'demo/a': 'off' } }",
      ),
    };
    const pinned = { 'demo/a': 'error' } as const;

    expect((await check(testsOff, { pinned })).map(probeIn)).toEqual(['src/__lint_meta_probe__.test.ts']);
    expect(await check(testsOff, { pinned, exemptProbes: ['**/*.test.ts'] })).toEqual([]);

    const allTsOff = {
      'apps/web/eslint.config.mjs': appendBlock(
        eslintConfigSource({ 'demo/a': 'error' }),
        "{ files: ['**/*.ts'], rules: { 'demo/a': 'off' } }",
      ),
    };
    expect((await check(allTsOff, { pinned, exemptProbes: ['**/*.test.ts'] })).map(probeIn)).toEqual([
      'src/__lint_meta_probe__.ts',
    ]);
  });

  test('an ignored probe never shifts which probe a report names', async () => {
    const violations = await check(
      {
        'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'off' }).replace(
          'export default [',
          "export default [\n  { ignores: ['src/ignored/**'] },",
        ),
      },
      { pinned: { 'demo/a': 'error' }, probes: ['src/ignored/a.ts', 'src/b.ts'] },
    );

    expect(violations).toHaveLength(1);
    expect(probeIn(violations[0] as IViolation)).toBe('src/b.ts');
    expect(violations[0]?.message).not.toContain('src/ignored/a.ts');
  });

  test('reports nothing without pinned, and reuses the shared defaults', async () => {
    const everythingOff = { 'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'off' }) };
    expect(await check(everythingOff)).toEqual([]);
    expect(await check(everythingOff, { pinned: {} })).toEqual([]);
    // Inert means no resolution at all, so even an unloadable config passes.
    expect(
      await check({ 'apps/web/eslint.config.mjs': "import 'this-package-does-not-exist-anywhere';\nexport default [];\n" }),
    ).toEqual([]);

    const rule = createEslintRulesNotWeakenedRule();
    expect(rule.id).toBe('eslint-rules-not-weakened');
    expect(rule.ciCritical).toBe(true);
    expect(typeof rule.runAsync).toBe('function');
    expect(rule.run).toBeUndefined();

    const pinned = { 'demo/a': 'error' } as const;
    const defaults = await check(
      {
        'eslint.config.mjs': eslintConfigSource({ 'demo/a': 'off' }),
        'apps/web/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'off' }),
        'packages/ui/eslint.config.js': eslintConfigSource({ 'demo/a': 'off' }),
      },
      { pinned, probes: ['src/a.ts'] },
    );
    expect(defaults.map((v) => v.file)).toEqual([
      'eslint.config.mjs',
      'apps/web/eslint.config.mjs',
      'packages/ui/eslint.config.js',
    ]);

    const services = {
      'services/billing/eslint.config.mjs': eslintConfigSource({ 'demo/a': 'off' }).replace(
        "files: ['**/*.ts', '**/*.tsx']",
        "files: ['lib/**/*.js']",
      ),
    };
    expect(await check(services, { pinned })).toEqual([]);
    const custom = await check(services, {
      id: 'pins-services',
      pinned,
      packages: ['services/*'],
      configFiles: ['eslint.config.mjs'],
      probes: ['lib/probe.js'],
      ciCritical: false,
    });
    expect(custom.map((v) => [v.rule, v.file, probeIn(v)])).toEqual([
      ['pins-services', 'services/billing/eslint.config.mjs', 'lib/probe.js'],
    ]);
  });

  test('fails closed when the config cannot be resolved', async () => {
    const violations = await check(
      { 'apps/web/eslint.config.mjs': "import 'this-package-does-not-exist-anywhere';\nexport default [];\n" },
      { pinned: PIN },
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('apps/web/eslint.config.mjs');
    expect(violations[0]?.message).toMatch(/Could not resolve the effective ESLint config for "apps\/web"/u);
  });
});

describe('eslint-rules-not-weakened through the real harness', () => {
  const files = {
    ...withPreset(['error', { assertionStyle: 'as' }]),
    'apps/api/eslint.config.mjs': eslintConfigSource({ [RULE]: ['error', { assertionStyle: 'never' }] }),
  };
  const options = { pinned: PIN, probes: ['src/index.ts'] };
  const expected = [`eslint-rules-not-weakened (packages/ui/eslint.config.mjs): Rule "${RULE}"`];
  const summarise = (lines: readonly string[]): string[] => lines.map((line) => line.split(' has a')[0] ?? line);

  test('under Bun, from source', () => {
    const run = runLintMetaOnRealTree(files, 'createEslintRulesNotWeakenedRule', options);
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);

  test('under Node with ESLint 9.0.0 (the peer floor), from the built package', () => {
    const run = runLintMetaOnRealTree(files, 'createEslintRulesNotWeakenedRule', options, {
      runtime: 'node-eslint9',
    });
    expect(run.stdout).toMatch(/^eslint 9\.0\.0$/mu);
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);
});
