import { describe, expect, test } from 'bun:test';

import { createNoctcorePackagesCurrentRule } from '../../src/rules/noctcore-packages-current';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const NAME = '@noctcore/eslint-plugin-demo';
const MODULE = `node_modules/${NAME}/package.json`;

const manifest = (range: string, name = NAME): string =>
  JSON.stringify({ name: 'fixture', devDependencies: { [name]: range } }, null, 2);
const installed = (version: string): string => JSON.stringify({ name: NAME, version });

const offline = createNoctcorePackagesCurrentRule();

/** A registry stub that answers from a fixed map and counts its calls. */
function stubRegistry(latest: Record<string, string | null>) {
  const calls: string[] = [];
  return {
    calls,
    fetchLatest: async (name: string): Promise<string | null> => {
      calls.push(name);
      return latest[name] ?? null;
    },
  };
}

describe('noctcore-packages-current, offline', () => {
  test('reports a caret 0.x range that cannot reach the installed minor', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.3.0') } });
    const violations = offline.run?.(ctx) ?? [];

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/declared "\^0\.2\.0" but 0\.3\.0 is installed/u);
    expect(violations[0]?.message).toContain('Widen the range to "^0.3.0"');
  });

  test('passes when the range and the installed minor agree', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.3.0'), [MODULE]: installed('0.3.1') } });
    expect(offline.run?.(ctx)).toEqual([]);
  });

  test('resolves a workspace package from its own node_modules first, then up to the root', () => {
    // pnpm isolates a workspace dependency under the workspace; a hoisting installer puts it at the root.
    const isolated = createFakeCtx({
      files: { 'packages/config/package.json': manifest('^0.2.0'), [`packages/config/${MODULE}`]: installed('0.2.4') },
    });
    const hoisted = createFakeCtx({
      files: { 'packages/config/package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.4') },
    });
    expect(offline.run?.(isolated)).toEqual([]);
    expect(offline.run?.(hoisted)).toEqual([]);
  });

  test('reports a declared package that is not installed anywhere', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0') } });
    const violations = offline.run?.(ctx) ?? [];
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('is not installed for "package.json"');
  });

  test('reports an install below the range as stale', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.4.2'), [MODULE]: installed('0.4.0') } });
    expect(offline.run?.(ctx)?.[0]?.message).toContain('below the range. The install is stale');
  });

  test('ignores ranges that cannot hide the trap: exact pins, workspace links, tags', () => {
    for (const range of ['0.4.0', 'workspace:*', 'latest']) {
      const ctx = createFakeCtx({ files: { 'package.json': manifest(range), [MODULE]: installed('0.9.0') } });
      expect(offline.run?.(ctx)).toEqual([]);
    }
  });

  test('ignores packages outside the scope, and honours another scope', () => {
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest('^0.2.0', '@acme/lint'),
        'node_modules/@acme/lint/package.json': JSON.stringify({ version: '0.3.0' }),
      },
    });
    expect(offline.run?.(ctx)).toEqual([]);
    expect(createNoctcorePackagesCurrentRule({ scope: '@acme' }).run?.(ctx)).toHaveLength(1);
  });
});

describe('noctcore-packages-current, registry', () => {
  test('stays offline by default: no registry read at all', async () => {
    const registry = stubRegistry({ [NAME]: '0.9.0' });
    const rule = createNoctcorePackagesCurrentRule({ fetchLatest: registry.fetchLatest });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.0') } });

    expect(await rule.runAsync?.(ctx)).toEqual([]);
    expect(registry.calls).toEqual([]);
  });

  test('reports a range that cannot reach the latest published minor', async () => {
    const registry = stubRegistry({ [NAME]: '0.3.1' });
    const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: registry.fetchLatest });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.5') } });

    const violations = (await rule.runAsync?.(ctx)) ?? [];
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('cannot reach the latest published 0.3.1');
    expect(violations[0]?.message).toContain('Widen the range to "^0.3.1"');
  });

  test('passes a range that admits the latest version', async () => {
    const registry = stubRegistry({ [NAME]: '0.2.9' });
    const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: registry.fetchLatest });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.5') } });
    expect(await rule.runAsync?.(ctx)).toEqual([]);
  });

  test('a stale registry read right after a publish does not report', async () => {
    // Just published and installed 0.3.0; the registry still says 0.2.9 is latest.
    const registry = stubRegistry({ [NAME]: '0.2.9' });
    const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: registry.fetchLatest });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.3.0'), [MODULE]: installed('0.3.0') } });
    expect(await rule.runAsync?.(ctx)).toEqual([]);
  });

  test('an installed version at or past the registry latest is the registry lagging, not the repo', async () => {
    const registry = stubRegistry({ [NAME]: '0.3.0' });
    const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: registry.fetchLatest });
    // The range is behind, but the offline half reports that; the registry half stays quiet.
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.3.0') } });
    expect(await rule.runAsync?.(ctx)).toEqual([]);
    expect(rule.run?.(ctx)).toHaveLength(1);
  });

  test('an unreachable registry is skipped, never reported', async () => {
    const failing = createNoctcorePackagesCurrentRule({
      checkRegistry: true,
      fetchLatest: () => Promise.reject(new Error('getaddrinfo ENOTFOUND registry.npmjs.org')),
    });
    const unknown = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: async () => null });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.0') } });
    expect(await failing.runAsync?.(ctx)).toEqual([]);
    expect(await unknown.runAsync?.(ctx)).toEqual([]);
  });

  test('the default registry read fails quiet with no network', async () => {
    // An unroutable registry URL: the real fetch path, offline.
    const rule = createNoctcorePackagesCurrentRule({
      checkRegistry: true,
      registryUrl: 'http://127.0.0.1:9',
      registryTimeoutMs: 2000,
    });
    const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.2.0'), [MODULE]: installed('0.2.0') } });
    expect(await rule.runAsync?.(ctx)).toEqual([]);
  });

  test('the default registry read asks `<registry>/<scope>%2f<name>/latest` over HTTP', async () => {
    const paths: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname);
        return Response.json({ name: NAME, version: '0.5.0' });
      },
    });
    try {
      const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, registryUrl: `http://127.0.0.1:${String(server.port)}/` });
      const ctx = createFakeCtx({ files: { 'package.json': manifest('^0.4.0'), [MODULE]: installed('0.4.1') } });
      const violations = (await rule.runAsync?.(ctx)) ?? [];
      expect(paths).toEqual(['/@noctcore%2feslint-plugin-demo/latest']);
      expect(violations[0]?.message).toContain('latest published 0.5.0');
    } finally {
      await server.stop(true);
    }
  });

  test('asks the registry once per package', async () => {
    const registry = stubRegistry({ [NAME]: '0.2.0' });
    const rule = createNoctcorePackagesCurrentRule({ checkRegistry: true, fetchLatest: registry.fetchLatest });
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest('^0.2.0'),
        'apps/web/package.json': manifest('^0.2.0'),
        [MODULE]: installed('0.2.0'),
      },
    });
    await rule.runAsync?.(ctx);
    expect(registry.calls).toEqual([NAME]);
  });
});
