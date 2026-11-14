import { describe, expect, test } from 'bun:test';

import {
  createTestFilesRequireSourceSiblingRule,
  type TestFilesRequireSourceSiblingOptions,
} from '../../src/rules/test-files-require-source-sibling';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { createFixture, runSync } from '../test-utils/diskFixture';

const RULE_ID = 'test-files-require-source-sibling';

function run(paths: readonly string[], options: TestFilesRequireSourceSiblingOptions = {}) {
  const files = Object.fromEntries(paths.map((path) => [path, '']));
  return runSync(createTestFilesRequireSourceSiblingRule(options), createFakeCtx({ files }));
}

function reported(paths: readonly string[], options: TestFilesRequireSourceSiblingOptions = {}): string[] {
  return run(paths, options).map((violation) => violation.file ?? '');
}

describe('test-files-require-source-sibling', () => {
  test('reports a test with no source beside it, naming every candidate', () => {
    const violations = run(['src/a/Orphan.test.ts']);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/a/Orphan.test.ts');
    expect(violations[0]?.rule).toBe(RULE_ID);
    const message = violations[0]?.message ?? '';
    for (const candidate of [
      'src/a/Orphan.ts',
      'src/a/Orphan.tsx',
      'src/a/Orphan.mts',
      'src/a/Orphan.cts',
      'src/a/Orphan.js',
      'src/a/Orphan/index.ts',
      'src/a/Orphan/index.tsx',
    ]) {
      expect(message).toContain(candidate);
    }
  });

  test('accepts a test beside its source', () => {
    expect(run(['src/a/Kept.test.tsx', 'src/a/Kept.ts'])).toEqual([]);
  });

  test('accepts a source with any listed extension', () => {
    const tests = ['src/m.test.ts', 'src/c.test.ts', 'src/j.test.ts'];

    expect(run([...tests, 'src/m.mts', 'src/c.cts', 'src/j.js'])).toEqual([]);
    expect(reported(tests)).toEqual([...tests].sort());
  });

  test('ignores an extension that is not listed', () => {
    expect(reported(['src/a.test.ts', 'src/a.jsx'])).toEqual(['src/a.test.ts']);
    expect(run(['src/a.test.ts', 'src/a.jsx'], { sourceExtensions: ['.jsx'] })).toEqual([]);
  });

  test("accepts a directory module's index by default", () => {
    expect(run(['src/Button.test.tsx', 'src/Button/index.tsx'])).toEqual([]);
  });

  test('reports a directory module with directoryModules: false', () => {
    expect(reported(['src/Button.test.tsx', 'src/Button/index.tsx'], { directoryModules: false })).toEqual([
      'src/Button.test.tsx',
    ]);
  });

  test('omits the index candidates from the message with directoryModules: false', () => {
    const message = run(['src/x.test.ts'], { directoryModules: false })[0]?.message ?? '';

    expect(message).toContain('src/x.ts');
    expect(message).not.toContain('index');
  });

  test('reports a test beside a folder with no index, on disk', () => {
    const fixture = createFixture({
      'src/Button.test.tsx': '',
      'src/Button/Button.styles.ts': '',
    });

    const violations = runSync(createTestFilesRequireSourceSiblingRule(), fixture.context());

    expect(violations.map((violation) => violation.file)).toEqual(['src/Button.test.tsx']);
  });

  test("accepts a directory module's index on disk", () => {
    const fixture = createFixture({
      'src/Button.test.tsx': '',
      'src/Button/index.tsx': '',
    });

    expect(runSync(createTestFilesRequireSourceSiblingRule(), fixture.context())).toEqual([]);
  });

  test('never reports a test outside every root', () => {
    expect(run(['lib/x.test.ts'])).toEqual([]);
    expect(reported(['lib/x.test.ts'], { roots: ['lib'] })).toEqual(['lib/x.test.ts']);
  });

  test('accepts glob roots', () => {
    const paths = ['packages/a/src/x.test.ts', 'packages/b/src/y.test.ts', 'packages/b/src/y.ts'];

    expect(reported(paths, { roots: ['packages/*/src'] })).toEqual(['packages/a/src/x.test.ts']);
  });

  test('accepts a root written with a trailing slash', () => {
    expect(reported(['src/x.test.ts'], { roots: ['src/'] })).toEqual(['src/x.test.ts']);
  });

  test('checks .spec files only when configured', () => {
    expect(run(['src/x.spec.ts'])).toEqual([]);
    expect(reported(['src/x.spec.ts'], { testSuffixes: ['.spec.ts'] })).toEqual(['src/x.spec.ts']);
  });

  test('strips the longest matching suffix and reports a test once', () => {
    const options = { testSuffixes: ['.test.ts', '.unit.test.ts'] };

    expect(run(['src/x.unit.test.ts', 'src/x.ts'], options)).toEqual([]);
    expect(reported(['src/x.unit.test.ts'], options)).toEqual(['src/x.unit.test.ts']);
  });

  test('skips a test matched by ignore', () => {
    const paths = ['src/legacy/old.test.ts'];

    expect(run(paths, { ignore: ['src/legacy/**'] })).toEqual([]);
    expect(reported(paths)).toEqual(['src/legacy/old.test.ts']);
  });

  test('reports each test once with overlapping roots', () => {
    expect(reported(['src/a/x.test.ts'], { roots: ['src', 'src/a'] })).toEqual(['src/a/x.test.ts']);
  });

  test('never walks node_modules or dist under a root', () => {
    expect(run(['src/node_modules/p/x.test.ts', 'src/dist/y.test.ts'])).toEqual([]);
  });

  test('reports in a stable, sorted order', () => {
    expect(reported(['src/b.test.ts', 'src/a.test.tsx', 'src/c/a.test.ts'])).toEqual([
      'src/a.test.tsx',
      'src/b.test.ts',
      'src/c/a.test.ts',
    ]);
  });

  test('metadata', () => {
    const rule = createTestFilesRequireSourceSiblingRule();

    expect(rule.id).toBe(RULE_ID);
    expect(rule.category).toBe('testing');
    expect(rule.ciCritical).toBe(true);
    expect(createTestFilesRequireSourceSiblingRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
