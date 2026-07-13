import { describe, expect, test } from 'bun:test';

import { createNoClonedComponentFoldersRule } from '../../src/rules/no-cloned-component-folders';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const ROOT = 'apps/web/src/components';
const rule = createNoClonedComponentFoldersRule();

function folder(feature: string, name: string) {
  return { [`${ROOT}/${feature}/${name}/index.ts`]: 'export {}' };
}

describe('no-cloned-component-folders', () => {
  test('flags a folder cloned across two features', () => {
    const ctx = createFakeCtx({
      files: { ...folder('insight', 'RunControls'), ...folder('harness', 'RunControls') },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('RunControls');
  });

  test('passes a folder that exists under only one feature', () => {
    const ctx = createFakeCtx({ files: folder('insight', 'RunControls') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('ignores excluded features (ui/app)', () => {
    const ctx = createFakeCtx({
      files: { ...folder('ui', 'Shell'), ...folder('app', 'Shell') },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('an allowlisted clone is suppressed', () => {
    const custom = createNoClonedComponentFoldersRule({ allowedClones: ['RunControls'] });
    const ctx = createFakeCtx({
      files: { ...folder('insight', 'RunControls'), ...folder('harness', 'RunControls') },
    });
    expect(custom.run(ctx)).toHaveLength(0);
  });

  test('a stale allowlist entry (no clone group left) is flagged', () => {
    const custom = createNoClonedComponentFoldersRule({ allowedClones: ['Gone'] });
    const ctx = createFakeCtx({ files: folder('insight', 'RunControls') });
    const v = custom.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('stale');
  });
});
