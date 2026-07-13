import { describe, expect, test } from 'bun:test';

import { createCanonicalHelpersSingleHomeRule } from '../../src/rules/canonical-helpers-single-home';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createCanonicalHelpersSingleHomeRule();

describe('canonical-helpers-single-home', () => {
  test('flags the same exported helper name in two homes', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/a.utils.ts': 'export function slug() {}',
        'apps/web/src/b.utils.ts': 'export const slug = () => {};',
      },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("'slug'");
  });

  test('passes when exported names are unique', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/a.utils.ts': 'export function slug() {}',
        'apps/web/src/b.utils.ts': 'export function dash() {}',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('parses `export { … }` lists (keyed on the local name before `as`)', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/a.utils.ts': 'const shared = 1; export { shared, other as a };',
        'apps/web/src/b.utils.ts': 'const shared = 2; export { shared };',
      },
    });
    expect(rule.run(ctx).some((v) => v.message.includes("'shared'"))).toBe(true);
  });

  test('excludes paths matching excludeContains (default /lib/)', () => {
    const ctx = createFakeCtx({
      files: {
        'apps/web/src/lib/a.utils.ts': 'export function slug() {}',
        'apps/web/src/b.utils.ts': 'export function slug() {}',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });
});
