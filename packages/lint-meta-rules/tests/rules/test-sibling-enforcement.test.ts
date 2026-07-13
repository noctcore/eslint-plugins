import { describe, expect, test } from 'bun:test';

import { createTestSiblingEnforcementRule } from '../../src/rules/test-sibling-enforcement';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createTestSiblingEnforcementRule();

describe('test-sibling-enforcement', () => {
  test('flags a utils file with no colocated test', () => {
    const ctx = createFakeCtx({ files: { 'apps/web/src/format.utils.ts': 'export const f = 1;' } });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe('apps/web/src/format.utils.ts');
  });

  test('passes with a .test.ts sibling', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/format.utils.ts': 'export const f = 1;',
        'apps/web/src/format.utils.test.ts': 'test',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('passes with a .test.tsx sibling', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/format.utils.ts': 'export const f = 1;',
        'apps/web/src/format.utils.test.tsx': 'test',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('honors a custom include + testExtensions', () => {
    const custom = createTestSiblingEnforcementRule({
      include: ['src/**/*.service.ts'],
      testExtensions: ['.spec.ts'],
    });
    const missing = createFakeCtx({ files: { 'src/a/payment.service.ts': 'x' } });
    const present = createFakeCtx({
      files: { 'src/a/payment.service.ts': 'x', 'src/a/payment.service.spec.ts': 'x' },
    });
    expect(custom.run(missing)).toHaveLength(1);
    expect(custom.run(present)).toHaveLength(0);
  });
});
