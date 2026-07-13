import { describe, expect, test } from 'bun:test';

import { createUiPrimitiveShapeRule } from '../../src/rules/ui-primitive-shape';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const UI = 'apps/web/src/components/ui';
const rule = createUiPrimitiveShapeRule();

describe('ui-primitive-shape', () => {
  test('flags a folder primitive missing its test sibling', () => {
    const ctx = createFakeCtx({
      files: {
        [`${UI}/Dialog/index.ts`]: 'export {}',
        [`${UI}/Dialog/Dialog.stories.tsx`]: 'x',
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('Dialog.test.tsx'))).toBe(true);
  });

  test('flags a folder primitive missing its stories sibling', () => {
    const ctx = createFakeCtx({
      files: {
        [`${UI}/Dialog/index.ts`]: 'export {}',
        [`${UI}/Dialog/Dialog.test.tsx`]: 'x',
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('Dialog.stories.tsx'))).toBe(true);
  });

  test('passes a folder primitive that ships both proof siblings', () => {
    const ctx = createFakeCtx({
      files: {
        [`${UI}/Dialog/index.ts`]: 'export {}',
        [`${UI}/Dialog/Dialog.test.tsx`]: 'x',
        [`${UI}/Dialog/Dialog.stories.tsx`]: 'x',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('flags a flat primitive that carries a sibling proof file at the ui root', () => {
    const ctx = createFakeCtx({
      files: {
        [`${UI}/Button.tsx`]: 'export {}',
        [`${UI}/Button.test.tsx`]: 'x',
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes("move both into a 'Button/'"))).toBe(true);
  });

  test('passes a bare flat presentational primitive', () => {
    const ctx = createFakeCtx({ files: { [`${UI}/Button.tsx`]: 'export {}' } });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('honors custom roles', () => {
    const custom = createUiPrimitiveShapeRule({ roles: ['test'] });
    const ctx = createFakeCtx({
      files: { [`${UI}/Dialog/index.ts`]: 'export {}', [`${UI}/Dialog/Dialog.test.tsx`]: 'x' },
    });
    expect(custom.run(ctx)).toHaveLength(0);
  });
});
