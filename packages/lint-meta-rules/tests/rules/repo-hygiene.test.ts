import { describe, expect, test } from 'bun:test';

import {
  createEslintOverridePathsExistRule,
  createGithubActionsTimeoutRequiredRule,
  createTsconfigIncludePathsExistRule,
} from '../../src/rules';
import { checkWorkflowTimeouts } from '../../src/rules/github-actions-timeout-required';
import { stripJsonc } from '../../src/rules/jsonc';
import { createFixture, messages, runSync } from '../test-utils/diskFixture';

/*
 * Cases ported from the consumer repo suites these factories replace, plus the
 * behaviour the published rules add (any indentation, glob prefixes, `files`).
 */

describe('github-actions-timeout-required', () => {
  const check = (text: string): string[] => messages(checkWorkflowTimeouts('ci.yml', text));

  test('reports a job with no timeout-minutes, naming the job and its line', () => {
    const violations = checkWorkflowTimeouts('ci.yml', 'jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: pnpm build\n');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message).toContain('job "build" has no job-level `timeout-minutes`');
  });

  test('passes a positive timeout and an expression', () => {
    expect(check('jobs:\n  build:\n    runs-on: x\n    timeout-minutes: 15\n')).toEqual([]);
    expect(check('jobs:\n  build:\n    timeout-minutes: ${{ inputs.minutes }}\n    runs-on: x\n')).toEqual([]);
  });

  test('rejects a zero timeout and a step-level timeout that does not cover the job', () => {
    expect(check('jobs:\n  build:\n    timeout-minutes: 0\n    runs-on: x\n')[0]).toContain('not a positive number');
    expect(check('jobs:\n  build:\n    runs-on: x\n    steps:\n      - run: a\n        timeout-minutes: 5\n')).toHaveLength(1);
  });

  test('exempts a reusable-workflow call, which cannot set a timeout', () => {
    expect(check('jobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n')).toEqual([]);
  });

  test('checks every job independently and stops at the next top-level key', () => {
    const text = 'jobs:\n  lint:\n    timeout-minutes: 10\n    runs-on: x\n  test:\n    runs-on: x\n  deploy:\n    runs-on: x\nenv:\n  FOO: bar\n';
    expect(check(text).map((message) => /job "(\w+)"/u.exec(message)?.[1])).toEqual(['test', 'deploy']);
  });

  test('reads four-space indentation, quoted job ids and comments', () => {
    const text = 'jobs:   # all jobs\n    "build-web":\n        runs-on: x # pinned\n        timeout-minutes: 20 # p95 is 12\n    e2e:\n        runs-on: x\n';
    expect(check(text).map((message) => /job "([\w-]+)"/u.exec(message)?.[1])).toEqual(['e2e']);
  });

  test('ignores a timeout-minutes nested deeper than the job (a step, a service)', () => {
    const text = 'jobs:\n  build:\n    runs-on: x\n    services:\n      db:\n        timeout-minutes: 5\n';
    expect(check(text)).toHaveLength(1);
  });

  test('reports nothing for a workflow with no jobs block', () => {
    expect(check('name: empty\non: push\n')).toEqual([]);
  });

  test('reaches workflow files through the configured globs', () => {
    const fixture = createFixture({
      '.github/workflows/ci.yml': 'jobs:\n  build:\n    runs-on: x\n',
      'ci/other.yml': 'jobs:\n  build:\n    runs-on: x\n',
    });
    expect(runSync(createGithubActionsTimeoutRequiredRule(), fixture.context()).map((v) => v.file)).toEqual([
      '.github/workflows/ci.yml',
    ]);
    expect(
      runSync(createGithubActionsTimeoutRequiredRule({ workflowGlobs: ['ci/*.yml'] }), fixture.context()).map((v) => v.file),
    ).toEqual(['ci/other.yml']);
  });
});

describe('eslint-override-paths-exist', () => {
  const CONFIG = 'apps/web/eslint.config.js';
  const config = (body: string): string => `export default [\n${body}\n];\n`;
  const rule = createEslintOverridePathsExistRule();

  test('reports a literal override path that no longer exists, with its line', () => {
    const fixture = createFixture({ [CONFIG]: config("  { files: ['src/routeTree.gen.ts'], rules: {} },") });
    const violations = runSync(rule, fixture.context());
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message).toContain('`files` names `src/routeTree.gen.ts`, which does not exist');
  });

  test('passes when the literal path exists relative to the config, not the repo root', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { files: ['src/routeTree.gen.ts'], rules: {} },"),
      'apps/web/src/routeTree.gen.ts': 'export {};\n',
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
    const rooted = createFixture({ [CONFIG]: config("  { files: ['src/only-in-root.ts'] },"), 'src/only-in-root.ts': '' });
    expect(runSync(rule, rooted.context())).toHaveLength(1);
  });

  test('checks the directory a files glob starts in, and passes globs with no literal directory', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { files: ['src/**/*.ts', 'legacy/**/*.{ts,tsx}', '**/*.test.ts', '!src/x.ts'], rules: {} },"),
      'apps/web/src/a.ts': '',
    });
    const violations = runSync(rule, fixture.context());
    expect(messages(violations)).toHaveLength(1);
    expect(violations[0]?.message).toContain('`legacy/**/*.{ts,tsx}`, whose directory `legacy` does not exist');
    expect(runSync(createEslintOverridePathsExistRule({ checkGlobPrefixes: false }), fixture.context())).toEqual([]);
  });

  test('checks one-file ignores, never directory or glob ignores (build output a clean checkout lacks)', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { ignores: ['dist', 'coverage/', '**/*.gen.ts', 'src/gone.ts'] },\n  globalIgnores(['src/also-gone.ts']),"),
    });
    const violations = runSync(rule, fixture.context());
    expect(messages(violations).map((message) => /`(src\/[\w-]+\.ts)`/u.exec(message)?.[1])).toEqual([
      'src/gone.ts',
      'src/also-gone.ts',
    ]);
    expect(runSync(createEslintOverridePathsExistRule({ checkIgnores: false }), fixture.context())).toEqual([]);
  });

  test('ignores paths in comments, imports and other keys, and computed templates', () => {
    const fixture = createFixture({
      [CONFIG]: [
        "import local from './rules/local.js';",
        '// was { files: ["src/old/thing.ts"] }',
        '/* files: ["src/older/thing.ts"] */',
        'const dir = "src";',
        'export default [',
        "  { settings: { tsconfig: 'tsconfig.app.json' }, files: [`${dir}/**/*.ts`] },",
        "  { files: ['https://example.com/x.ts'.length > 0 ? 'src/a.ts' : 'src/a.ts'] },",
        '];',
        '',
      ].join('\n'),
      'apps/web/src/a.ts': '',
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('reads every flat config extension in nested packages, and skips node_modules', () => {
    const fixture = createFixture({
      'packages/ui/eslint.config.mjs': config("  { files: ['src/gone.ts'] },"),
      'packages/api/eslint.config.ts': config("  { files: ['src/gone.ts'] },"),
      'packages/node_modules/dep/eslint.config.js': config("  { files: ['src/gone.ts'] },"),
    });
    expect(runSync(rule, fixture.context()).map((v) => v.file)).toEqual([
      'packages/api/eslint.config.ts',
      'packages/ui/eslint.config.mjs',
    ]);
  });
});

describe('tsconfig-include-paths-exist', () => {
  const rule = createTsconfigIncludePathsExistRule();

  test('reports an include entry whose folder is gone, relative to the config', () => {
    const fixture = createFixture({
      'apps/web/tsconfig.json': JSON.stringify({ include: ['src', 'e2e'] }),
      'apps/web/src/main.ts': '',
      'e2e/spec.ts': '',
    });
    const violations = runSync(rule, fixture.context());
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('apps/web/tsconfig.json');
    expect(violations[0]?.message).toContain('`include` names `e2e`, which does not exist');
  });

  test('checks the directory a glob entry starts in', () => {
    const fixture = createFixture({
      'tsconfig.json': JSON.stringify({ include: ['src/**/*.ts', 'scripts/**/*', '**/*.d.ts'] }),
      'src/a.ts': '',
    });
    expect(messages(runSync(rule, fixture.context()))).toEqual([
      expect.stringContaining('`scripts/**/*`, whose directory `scripts` does not exist'),
    ]);
    expect(runSync(createTsconfigIncludePathsExistRule({ checkGlobPrefixes: false }), fixture.context())).toEqual([]);
  });

  test('checks files entries, and accepts an entry that climbs out of the workspace', () => {
    const fixture = createFixture({
      'packages/a/tsconfig.json': JSON.stringify({ files: ['src/index.ts', 'src/gone.ts'], include: ['../shared'] }),
      'packages/a/src/index.ts': '',
      'packages/shared/x.ts': '',
    });
    expect(messages(runSync(rule, fixture.context()))).toEqual([expect.stringContaining('`files` names `src/gone.ts`')]);
  });

  test('reads JSONC: comments, trailing commas and `//` inside strings', () => {
    const fixture = createFixture({
      'tsconfig.app.json': '{\n  // app sources\n  "include": [\n    "src/**/*", /* main */\n    "gone",\n  ],\n  "compilerOptions": { "baseUrl": "https://x//y" },\n}\n',
      'src/a.ts': '',
    });
    expect(messages(runSync(rule, fixture.context()))).toEqual([expect.stringContaining('`include` names `gone`')]);
  });

  test('skips hidden entries, ${configDir}, unparseable configs and dependency trees', () => {
    const fixture = createFixture({
      'tsconfig.json': JSON.stringify({ include: ['.astro/types.d.ts', '${configDir}/src', '.storybook'] }),
      'src/a.ts': '',
      'tsconfig.broken.json': '{ "include": [',
      'node_modules/pkg/tsconfig.json': JSON.stringify({ include: ['gone'] }),
      'dist/tsconfig.json': JSON.stringify({ include: ['gone'] }),
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
    expect(
      messages(runSync(createTsconfigIncludePathsExistRule({ skipHiddenEntries: false }), fixture.context())),
    ).toHaveLength(2);
  });

  test('stripJsonc keeps strings intact', () => {
    expect(JSON.parse(stripJsonc('{"a": "//not a comment", "b": [1,],}'))).toEqual({ a: '//not a comment', b: [1] });
  });
});
