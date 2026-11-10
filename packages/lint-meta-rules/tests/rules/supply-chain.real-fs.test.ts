import { describe, expect, test } from 'bun:test';

import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

/*
 * The supply-chain rules on a REAL temp directory, run through the real harness
 * CLI. The per-rule tests cover the logic; these prove each rule reaches its
 * files through the harness's own read and glob, including dot-directories
 * (`.github/workflows`) and nested `node_modules`.
 */

// Spawning the CLI costs a Bun startup per test; give a slow runner room.
const TIMEOUT_MS = 30_000;

describe('supply-chain rules on a real tree', () => {
  test(
    'banned-dependencies reads a workspace manifest',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'package.json': JSON.stringify({ name: 'root' }),
          'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { axios: '^1.7.0' } }),
        },
        'createBannedDependenciesRule',
        { banned: { axios: 'Use fetch.' } },
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(apps/web/package.json)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'noctcore-packages-current reads the installed version under node_modules',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'package.json': JSON.stringify({ name: 'root', devDependencies: { '@noctcore/eslint-plugin-demo': '^0.2.0' } }),
          'node_modules/@noctcore/eslint-plugin-demo/package.json': JSON.stringify({ version: '0.3.0' }),
        },
        'createNoctcorePackagesCurrentRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('declared "^0.2.0" but 0.3.0 is installed');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'node-version-parity reaches .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.nvmrc': '22\n',
          'package.json': JSON.stringify({ name: 'root', engines: { node: '>=22.0.0' } }),
          '.github/workflows/ci.yml':
            'name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 20\n',
        },
        'createNodeVersionParityRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('installs Node 20; .nvmrc says 22');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'pnpm-hardening-settings reads pnpm-workspace.yaml and .npmrc',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'pnpm-workspace.yaml':
            'strictDepBuilds: true\nblockExoticSubdeps: true\nengineStrict: true\ntrustPolicy: no-downgrade\nminimumReleaseAge: 10080\n',
          '.npmrc': 'engine-strict=false\n',
          'package.json': JSON.stringify({ name: 'root' }),
        },
        'createPnpmHardeningSettingsRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.npmrc)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'pnpm-override-ledger reads the manifest, the ledger and the lockfile',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'package.json': JSON.stringify({ name: 'root', pnpm: { overrides: { 'tar@<7.5.21': '^7.5.21' } } }),
          'overrides.ledger.json': JSON.stringify({}),
          'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\npackages:\n\n  tar@7.5.21:\n    resolution: {integrity: sha512-x}\n",
        },
        'createPnpmOverrideLedgerRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('with no ledger entry');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );
});
