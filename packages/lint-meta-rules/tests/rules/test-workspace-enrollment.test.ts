import { describe, expect, test } from 'bun:test';

import { createTestWorkspaceEnrollmentRule } from '../../src/rules/test-workspace-enrollment';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createTestWorkspaceEnrollmentRule();

function manifest(testNode: string) {
  return JSON.stringify({ scripts: { 'test:node': testNode } });
}

describe('test-workspace-enrollment', () => {
  test('flags a tested package missing from the script', () => {
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest('bun test packages/other'),
        'packages/core/package.json': '{}',
        'packages/core/src/a.test.ts': 'test',
      },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("'packages/core'");
  });

  test('passes when the tested package is enumerated', () => {
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest('bun test packages/core'),
        'packages/core/package.json': '{}',
        'packages/core/src/a.test.ts': 'test',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('skips a package with no test files', () => {
    const ctx = createFakeCtx({
      files: { 'package.json': manifest(''), 'packages/core/package.json': '{}' },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('honors excludeDirs and extraDirs', () => {
    const custom = createTestWorkspaceEnrollmentRule({
      excludeDirs: ['packages/web'],
      extraDirs: ['apps/sidecar'],
    });
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest(''),
        'packages/web/package.json': '{}',
        'packages/web/a.test.ts': 'x', // excluded → no violation
        'apps/sidecar/a.test.ts': 'x', // extra dir with tests → violation
      },
    });
    const v = custom.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("'apps/sidecar'");
  });

  test('is a no-op when the manifest is missing or invalid', () => {
    expect(rule.run(createFakeCtx({ files: {} }))).toHaveLength(0);
    expect(rule.run(createFakeCtx({ files: { 'package.json': '{ not json' } }))).toHaveLength(0);
  });
});
