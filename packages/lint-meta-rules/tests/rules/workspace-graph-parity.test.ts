import { describe, expect, test } from 'bun:test';

import { createWorkspaceGraphParityRule } from '../../src/rules/workspace-graph-parity';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createWorkspaceGraphParityRule();

describe('workspace-graph-parity', () => {
  test('imported-but-undeclared dep is flagged (a)', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({ name: '@nightcore/engine', dependencies: {} }),
        'packages/engine/src/x.ts': "import { z } from '@nightcore/contracts';",
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('does not declare'))).toBe(true);
  });

  test('declared + imported + mirrored tsconfig reference passes', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({
          name: '@nightcore/engine',
          dependencies: { '@nightcore/contracts': 'workspace:*' },
        }),
        'packages/engine/src/x.ts': "import { z } from '@nightcore/contracts';",
        'packages/engine/tsconfig.json': JSON.stringify({ references: [{ path: '../contracts' }] }),
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('declared dep missing from tsconfig references is flagged (b)', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({
          name: '@nightcore/engine',
          dependencies: { '@nightcore/contracts': 'workspace:*' },
        }),
        'packages/engine/tsconfig.json': JSON.stringify({ references: [] }),
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('missing @nightcore/contracts'))).toBe(true);
  });

  test('tsconfig referencing a non-declared dep is flagged (b)', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({ name: '@nightcore/engine', dependencies: {} }),
        'packages/engine/tsconfig.json': JSON.stringify({ references: [{ path: '../contracts' }] }),
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('not a declared workspace:* dependency'))).toBe(true);
  });

  test('a self-import is ignored', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({ name: '@nightcore/engine', dependencies: {} }),
        'packages/engine/src/x.ts': "import { local } from '@nightcore/engine';",
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('test files are excluded from the import scan', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({ name: '@nightcore/engine', dependencies: {} }),
        'packages/engine/src/x.test.ts': "import { z } from '@nightcore/contracts';",
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('honors a custom scope', () => {
    const custom = createWorkspaceGraphParityRule({ scope: '@acme' });
    const ctx = createFakeCtx({
      files: {
        'packages/engine/package.json': JSON.stringify({ name: '@acme/engine', dependencies: {} }),
        'packages/engine/src/x.ts': "import { z } from '@acme/contracts';",
      },
    });
    expect(custom.run(ctx).some((x) => x.message.includes('@acme/contracts'))).toBe(true);
  });
});
