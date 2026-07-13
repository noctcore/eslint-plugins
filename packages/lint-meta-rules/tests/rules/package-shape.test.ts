import { describe, expect, test } from 'bun:test';

import { createPackageShapeRule } from '../../src/rules/package-shape';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createPackageShapeRule();

function libPkg(dir: string, pkg: object, extraBarrel = true) {
  return {
    [`${dir}/package.json`]: JSON.stringify(pkg),
    ...(extraBarrel ? { [`${dir}/src/index.ts`]: 'export {}' } : {}),
  };
}

describe('package-shape', () => {
  test('a correctly shaped library package passes', () => {
    const ctx = createFakeCtx({
      files: libPkg('packages/core', {
        name: '@nightcore/core',
        main: './dist/index.cjs',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        exports: { '.': './dist/index.js' },
      }),
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('flags a name that does not match its directory', () => {
    const ctx = createFakeCtx({
      files: libPkg('packages/core', { name: '@nightcore/wrong', main: './dist/x' }),
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes("must equal '@nightcore/core'"))).toBe(true);
  });

  test('an app package only gets the name check (no barrel/dist checks)', () => {
    const ctx = createFakeCtx({
      files: { 'apps/web/package.json': JSON.stringify({ name: '@nightcore/web', main: './src/main.tsx' }) },
    });
    // main not under dist/ and no src/index.ts, but apps are exempt from those.
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('flags a library missing its barrel', () => {
    const ctx = createFakeCtx({
      files: {
        'packages/core/package.json': JSON.stringify({ name: '@nightcore/core' }),
      },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('single barrel'))).toBe(true);
  });

  test('flags a dist field not pointing at built output, and exports too', () => {
    const ctx = createFakeCtx({
      files: libPkg('packages/core', {
        name: '@nightcore/core',
        main: './src/index.ts',
        exports: { '.': './src/index.ts' },
      }),
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.message.includes('"main"'))).toBe(true);
    expect(v.some((x) => x.message.includes('"exports"'))).toBe(true);
  });

  test('flags invalid JSON', () => {
    const ctx = createFakeCtx({ files: { 'packages/core/package.json': '{ not json' } });
    expect(rule.run(ctx).some((x) => x.message.includes('not valid JSON'))).toBe(true);
  });

  test('honors externalNames overrides', () => {
    const custom = createPackageShapeRule({ externalNames: { 'packages/harness': '@noctcore/harness' } });
    const ctx = createFakeCtx({
      files: libPkg('packages/harness', {
        name: '@noctcore/harness',
        main: './dist/index.cjs',
      }),
    });
    expect(custom.run(ctx)).toHaveLength(0);
  });

  test('honors a custom scope', () => {
    const custom = createPackageShapeRule({ scope: '@acme' });
    const ctx = createFakeCtx({
      files: libPkg('packages/core', { name: '@acme/core', main: './dist/x' }),
    });
    expect(custom.run(ctx)).toHaveLength(0);
  });
});
