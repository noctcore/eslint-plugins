import { describe, expect, test } from 'bun:test';

import { createLayerRankRule } from '../../src/rules/layer-rank';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const RANKS = { contracts: 1, shared: 2, storage: 3, skills: 3, engine: 4 };
const rule = createLayerRankRule({ ranks: RANKS, surfaceRank: 5 });

function fileWithImport(rel: string, spec: string) {
  return { [rel]: `import { x } from '${spec}';` };
}

describe('layer-rank', () => {
  test('a downward import (higher → lower) is allowed', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/engine/src/x.ts', '@nightcore/contracts') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('an upward import (lower → higher) is flagged', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/contracts/src/x.ts', '@nightcore/engine') });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('upward');
  });

  test('a sideways import (equal rank) is flagged', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/storage/src/x.ts', '@nightcore/skills') });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('sideways');
  });

  test('an unranked target is skipped', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/contracts/src/x.ts', '@nightcore/config') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('an unranked importer is skipped', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/config/src/x.ts', '@nightcore/engine') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('a surface (apps/) importing a lower rank is allowed', () => {
    const ctx = createFakeCtx({ files: fileWithImport('apps/web/src/x.ts', '@nightcore/engine') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('a surface importing another surface-rank package is flagged', () => {
    // A package explicitly ranked at the surface rank (5) imported from a surface.
    const withSurfacePkg = createLayerRankRule({ ranks: { ...RANKS, shell: 5 }, surfaceRank: 5 });
    const ctx = createFakeCtx({ files: fileWithImport('apps/web/src/x.ts', '@nightcore/shell') });
    expect(withSurfacePkg.run(ctx)).toHaveLength(1);
  });

  test('surfaces are unranked when no surfaceRank is configured', () => {
    const noSurface = createLayerRankRule({ ranks: RANKS });
    const ctx = createFakeCtx({ files: fileWithImport('apps/web/src/x.ts', '@nightcore/engine') });
    expect(noSurface.run(ctx)).toHaveLength(0);
  });

  test('test files are skipped', () => {
    const ctx = createFakeCtx({ files: fileWithImport('packages/contracts/src/x.test.ts', '@nightcore/engine') });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('an empty ranks table makes the rule inert', () => {
    const inert = createLayerRankRule();
    const ctx = createFakeCtx({ files: fileWithImport('packages/contracts/src/x.ts', '@nightcore/engine') });
    expect(inert.run(ctx)).toHaveLength(0);
  });
});
