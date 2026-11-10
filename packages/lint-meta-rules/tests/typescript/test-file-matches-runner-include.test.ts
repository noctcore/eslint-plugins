import { describe, expect, test } from 'bun:test';

import { createTestFileMatchesRunnerIncludeRule } from '../../src/typescript';
import { createFixture, runSync } from '../test-utils/diskFixture';

const rule = createTestFileMatchesRunnerIncludeRule();

function reported(files: Readonly<Record<string, string>>, options = {}): string[] {
  const fixture = createFixture(files);
  const target = Object.keys(options).length === 0 ? rule : createTestFileMatchesRunnerIncludeRule(options);
  return runSync(target, fixture.context()).map((violation) => violation.file);
}

describe('test-file-matches-runner-include: vitest', () => {
  // The consumer case: `.utils.test.ts` files never ran because the project included only `*.test.tsx`.
  test('reports a test file the include does not collect', () => {
    const fixture = createFixture({
      'apps/web/vitest.config.ts':
        "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['src/**/*.test.tsx'] } });\n",
      'apps/web/src/format.utils.test.ts': '',
      'apps/web/src/Button.test.tsx': '',
    });
    const violations = runSync(rule, fixture.context());
    expect(violations.map((violation) => violation.file)).toEqual(['apps/web/src/format.utils.test.ts']);
    expect(violations[0]?.message).toContain('vitest (apps/web/vitest.config.ts) includes `src/**/*.test.tsx`');
  });

  test('applies the default include when none is set', () => {
    expect(
      reported({
        'vitest.config.mts': 'export default { test: { environment: "node" } };\n',
        'src/a.test.ts': '',
        'src/b.spec.mjs': '',
      }),
    ).toEqual([]);
  });

  test('reads inline projects with their own root, and the parent contributes no default', () => {
    expect(
      reported({
        'vitest.config.ts': [
          "import { defineConfig } from 'vitest/config';",
          'export default defineConfig({',
          '  test: {',
          '    projects: [',
          "      { test: { name: 'web', root: './apps/web', include: ['src/**/*.test.tsx'] } },",
          "      { test: { name: 'api', root: 'apps/api' } },",
          '    ],',
          '  },',
          '});',
          '',
        ].join('\n'),
        'apps/web/src/hook.test.ts': '',
        'apps/web/src/View.test.tsx': '',
        'apps/api/src/service.test.ts': '',
      }),
    ).toEqual(['apps/web/src/hook.test.ts']);
  });

  test('honours a literal exclude, including one written next to a spread of the defaults', () => {
    expect(
      reported({
        'vitest.config.ts':
          "import { configDefaults } from 'vitest/config';\nexport default { test: { exclude: [...configDefaults.exclude, 'src/legacy/**'] } };\n",
        'src/legacy/old.test.ts': '',
        'src/new.test.ts': '',
      }),
    ).toEqual(['src/legacy/old.test.ts']);
  });

  test('says nothing under a config it cannot read, even where a readable one misses the file', () => {
    expect(
      reported({
        'vitest.config.ts': "export default { test: { include: ['packages/**/*.test.ts'] } };\n",
        'apps/web/vitest.config.ts': "const include = ['src/**/*.test.tsx'];\nexport default { test: { include } };\n",
        'apps/web/src/a.test.ts': '',
        'apps/api/vitest.config.ts': "import base from '../../vite.config';\nexport default mergeConfig(base, {});\n",
        'apps/api/src/b.test.ts': '',
      }),
    ).toEqual([]);
  });

  test('a vite config without a test block is not a runner', () => {
    expect(reported({ 'vite.config.ts': 'export default { plugins: [] };\n', 'src/a.test.ts': '' })).toEqual([]);
  });
});

describe('test-file-matches-runner-include: other runners', () => {
  test('a Playwright testDir collects the e2e specs a narrower Vitest include leaves out', () => {
    expect(
      reported({
        'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
        'playwright.config.ts':
          "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e', use: {} });\n",
        'e2e/login.spec.ts': '',
        'src/a.test.ts': '',
        'tests/stray.spec.ts': '',
      }),
    ).toEqual(['tests/stray.spec.ts']);
  });

  test('reads jest testMatch with <rootDir>, testRegex, and the package.json jest key', () => {
    expect(
      reported({
        'packages/a/jest.config.js': "module.exports = { testMatch: ['<rootDir>/src/**/*.spec.ts'] };\n",
        'packages/a/src/x.spec.ts': '',
        'packages/a/src/y.test.ts': '',
        'packages/b/jest.config.ts': "const config = { testRegex: '/__tests__/.*\\\\.ts$' };\nexport default config;\n",
        'packages/b/src/__tests__/ok.test.ts': '',
        'packages/b/src/near.test.ts': '',
        'packages/c/package.json': JSON.stringify({ name: 'c', jest: {} }),
        'packages/c/src/__tests__/d.test.ts': '',
      }),
    ).toEqual(['packages/a/src/y.test.ts', 'packages/b/src/near.test.ts']);
  });

  test('a `bun test` script collects every test-named file under its package; a path filter is unreadable', () => {
    expect(
      reported({
        'package.json': JSON.stringify({ name: 'root', scripts: { test: 'bun test' } }),
        'packages/x/src/a.test.ts': '',
        'packages/x/src/b_spec.tsx': '',
      }),
    ).toEqual([]);
    expect(
      reported({
        'packages/x/package.json': JSON.stringify({ name: 'x', scripts: { test: 'bun test src' } }),
        'vitest.config.ts': "export default { test: { include: ['apps/**/*.test.ts'] } };\n",
        'packages/x/scripts/c.test.ts': '',
      }),
    ).toEqual([]);
  });
});

describe('test-file-matches-runner-include: options', () => {
  test('requireRunner reports a test file no runner covers', () => {
    const files = { 'apps/web/vitest.config.ts': 'export default { test: {} };\n', 'scripts/check.test.ts': '' };
    expect(reported(files)).toEqual([]);
    expect(reported(files, { requireRunner: true })).toEqual(['scripts/check.test.ts']);
  });

  test('declared runners, detect and allowedFiles', () => {
    const files = {
      'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'] } };\n",
      'tools/x.test.ts': '',
      'src/fixtures/sample.test.ts.snap.test.ts': '',
      'src/a.spec.ts': '',
    };
    expect(reported(files)).toEqual(['src/a.spec.ts', 'tools/x.test.ts']);
    expect(
      reported(files, {
        runners: [{ name: 'custom', dir: 'tools', include: ['**/*.test.ts'] }],
        allowedFiles: ['src/*.spec.ts'],
      }),
    ).toEqual([]);
    expect(reported(files, { detect: ['jest'] })).toEqual([]);
  });
});
