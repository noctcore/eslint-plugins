import { describe, expect, test } from 'bun:test';

import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

/*
 * The repo-hygiene rules on a REAL temp directory, run through the real harness
 * CLI. The per-rule tests cover the logic; these prove each rule reaches its
 * files through the harness's own read, exists and glob (dot-directories, brace
 * patterns, nested packages), and that the `/typescript` entry loads.
 */

// Spawning the CLI costs a Bun startup per test; give a slow runner room.
const TIMEOUT_MS = 30_000;

describe('repo-hygiene rules on a real tree', () => {
  test(
    'github-actions-timeout-required reads .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        { '.github/workflows/ci.yml': 'jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true\n' },
        'createGithubActionsTimeoutRequiredRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.github/workflows/ci.yml)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'github-actions-concurrency-explicit reads .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.github/workflows/ci.yml':
            'name: ci\non: push\nconcurrency:\n  group: ci\njobs:\n  build:\n    runs-on: ubuntu-24.04\n',
        },
        'createGithubActionsConcurrencyExplicitRule',
      );
      expect(run.stdout).toContain('github-actions-concurrency-explicit');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.github/workflows/ci.yml)');
      expect(run.violations[0]).toContain('line 3:');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'eslint-override-paths-exist reads a nested flat config and resolves against it',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'apps/web/eslint.config.mjs': "export default [{ files: ['src/routeTree.gen.ts', 'src/**/*.tsx'] }];\n",
          'apps/web/src/App.tsx': '',
        },
        'createEslintOverridePathsExistRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('src/routeTree.gen.ts');
    },
    TIMEOUT_MS,
  );

  test(
    'tsconfig-include-paths-exist reads tsconfig.*.json at any depth',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'packages/a/tsconfig.build.json': '{ // build\n  "include": ["src", "gone/**/*.ts"],\n}\n',
          'packages/a/src/index.ts': '',
        },
        'createTsconfigIncludePathsExistRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(packages/a/tsconfig.build.json)');
    },
    TIMEOUT_MS,
  );

  test(
    'no-inline-lint-disable and no-ts-ignore load from /typescript and read source',
    () => {
      const files = {
        'src/a.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n',
        'src/b.tsx': 'export const B = () => <p>{/* @ts-ignore */ x}</p>;\n',
        'src/routeTree.gen.ts': '/* eslint-disable */\n// @ts-ignore\n',
      };
      const disable = runLintMetaOnRealTree(files, 'createNoInlineLintDisableRule');
      expect(disable.violations).toHaveLength(1);
      expect(disable.violations[0]).toContain('(src/a.ts)');
      const ignore = runLintMetaOnRealTree(files, 'createNoTsIgnoreRule');
      expect(ignore.violations).toHaveLength(1);
      expect(ignore.violations[0]).toContain('(src/b.tsx)');
    },
    TIMEOUT_MS * 2,
  );

  test(
    'test-file-matches-runner-include reads a vitest config through the harness',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'apps/web/vitest.config.ts': "export default { test: { include: ['src/**/*.test.tsx'] } };\n",
          'apps/web/src/format.utils.test.ts': '',
          'apps/web/src/View.test.tsx': '',
        },
        'createTestFileMatchesRunnerIncludeRule',
      );
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(apps/web/src/format.utils.test.ts)');
    },
    TIMEOUT_MS,
  );
});
