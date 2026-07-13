import { describe, expect, test } from 'bun:test';

import { createTestRunnerSegregationRule } from '../../src/rules/test-runner-segregation';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createTestRunnerSegregationRule({ vitestDirs: ['packages/web'] });

describe('test-runner-segregation', () => {
  test('flags a bun-side test importing the foreign runner', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/core/package.json': '{}',
        'packages/core/a.test.ts': "import { test } from 'vitest';",
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes("imports 'vitest'"))).toBe(true);
  });

  test('flags a bun-side test missing the bun runner import', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/core/package.json': '{}',
        'packages/core/a.test.ts': "const x = 1;",
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes("must import its runner from 'bun:test'"))).toBe(true);
  });

  test('passes a bun-side test importing bun:test', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/core/package.json': '{}',
        'packages/core/a.test.ts': "import { test } from 'bun:test';",
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('flags a foreign-side test importing bun:test', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/web/package.json': '{}',
        'packages/web/a.test.ts': "import { test } from 'bun:test';",
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes("imports 'bun:test'"))).toBe(true);
  });

  test('a foreign-side test with no bun import passes (foreign runner may be transitive)', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/web/package.json': '{}',
        'packages/web/a.test.tsx': "import { render } from './test-utils';",
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('vitestDirs are excluded from the bun set (no missing-import error there)', () => {
    // packages/web is a vitest dir; it must NOT be required to import bun:test.
    const ctx = createFakeCtx({
      files: { 'packages/web/package.json': '{}', 'packages/web/a.test.ts': 'const x = 1;' },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });
});
