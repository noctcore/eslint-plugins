import { describe, expect, test } from 'bun:test';

import { createSharedToolVersionParityRule, declaredWorkspaces } from '../../src/rules/shared-tool-version-parity';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { createFixture, runSync } from '../test-utils/diskFixture';

const RULE_ID = 'shared-tool-version-parity';

function manifest(name: string, devDependencies: Record<string, string>, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name, ...extra, devDependencies }, null, 2)}\n`;
}

const ROOT = JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'packages/*'] });

function run(files: Record<string, string>, options = {}) {
  return createSharedToolVersionParityRule(options).run(createFakeCtx({ files: { 'package.json': ROOT, ...files } }));
}

describe('shared-tool-version-parity', () => {
  test('reports every declarer when two packages declare typescript at different versions, with file and line', () => {
    const violations = run({
      'apps/web/package.json': manifest('web', { typescript: '5.6.3' }),
      'apps/api/package.json': manifest('api', { typescript: '5.7.2' }),
    });

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.file)).toEqual(['apps/api/package.json', 'apps/web/package.json']);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message ?? '').toMatch(/^line 4: devDependencies\.typescript is `5\.7\.2`/u);
    expect(violations[0]?.message ?? '').toContain(
      '`5.6.3` in apps/web/package.json; `5.7.2` in apps/api/package.json',
    );
  });

  test('accepts two packages that declare the same version', () => {
    expect(
      run({
        'apps/web/package.json': manifest('web', { typescript: '5.7.2' }),
        'apps/api/package.json': manifest('api', { typescript: '5.7.2' }),
      }),
    ).toEqual([]);
  });

  test('never reports a tool only one package declares', () => {
    expect(
      run({
        'apps/web/package.json': manifest('web', { typescript: '5.7.2', prettier: '3.3.0' }),
        'apps/api/package.json': manifest('api', { typescript: '5.7.2' }),
      }),
    ).toEqual([]);
  });

  test('compares versions as written, so a range and an exact pin are drift', () => {
    const violations = run({
      'apps/web/package.json': manifest('web', { eslint: '^9.0.0' }),
      'apps/api/package.json': manifest('api', { eslint: '9.0.0' }),
    });

    expect(violations).toHaveLength(2);
  });

  test('skips workspace: and catalog: specifiers', () => {
    expect(
      run({
        'apps/web/package.json': manifest('web', { typescript: 'catalog:' }),
        'apps/api/package.json': manifest('api', { typescript: 'catalog:default' }),
        'packages/ui/package.json': manifest('ui', { typescript: '5.7.2' }),
      }),
    ).toEqual([]);
    expect(
      run(
        {
          'apps/web/package.json': manifest('web', { '@acme/config': 'workspace:*' }),
          'apps/api/package.json': manifest('api', { '@acme/config': 'workspace:^' }),
        },
        { toolPrefixes: ['@acme/'] },
      ),
    ).toEqual([]);
  });

  test('ignores dependencies that are not tools', () => {
    expect(
      run({
        'apps/web/package.json': manifest('web', { react: '19.0.0' }),
        'apps/api/package.json': manifest('api', { react: '18.3.1' }),
      }),
    ).toEqual([]);
  });

  test('toolPrefixes adds every dependency under a prefix', () => {
    const files = {
      'apps/web/package.json': manifest('web', { '@acme/eslint-config': '1.2.0' }),
      'apps/api/package.json': manifest('api', { '@acme/eslint-config': '1.3.0' }),
    };

    expect(run(files)).toEqual([]);
    expect(run(files, { toolPrefixes: ['@acme/'] })).toHaveLength(2);
  });

  test('tools replaces the default list', () => {
    const files = {
      'apps/web/package.json': manifest('web', { typescript: '5.6.3', knip: '5.0.0' }),
      'apps/api/package.json': manifest('api', { typescript: '5.7.2', knip: '5.1.0' }),
    };
    const violations = run(files, { tools: ['knip'] });

    expect(violations).toHaveLength(2);
    expect(violations[0]?.message ?? '').toContain('knip');
  });

  test('compares the root manifest too, unless includeRoot is false', () => {
    const root = JSON.stringify({ name: 'root', workspaces: ['apps/*'], devDependencies: { typescript: '5.6.3' } });
    const files = { 'package.json': root, 'apps/web/package.json': manifest('web', { typescript: '5.7.2' }) };

    expect(createSharedToolVersionParityRule().run(createFakeCtx({ files }))).toHaveLength(2);
    expect(createSharedToolVersionParityRule({ includeRoot: false }).run(createFakeCtx({ files }))).toEqual([]);
  });

  test('fields limits which dependency maps are read', () => {
    const files = {
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { typescript: '5.6.3' } }),
      'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { typescript: '5.7.2' } }),
    };

    expect(run(files)).toHaveLength(2);
    expect(run(files, { fields: ['devDependencies'] })).toEqual([]);
  });

  test('a package outside the workspaces is not compared', () => {
    expect(
      run({
        'apps/web/package.json': manifest('web', { typescript: '5.7.2' }),
        'examples/demo/package.json': manifest('demo', { typescript: '5.6.3' }),
      }),
    ).toEqual([]);
  });

  test('workspaces overrides the declared list and honours a ! exclusion', () => {
    const files = {
      'apps/web/package.json': manifest('web', { typescript: '5.7.2' }),
      'apps/legacy/package.json': manifest('legacy', { typescript: '5.6.3' }),
    };

    expect(run(files)).toHaveLength(2);
    expect(run(files, { workspaces: ['apps/*', '!apps/legacy'] })).toEqual([]);
  });

  test('reads workspaces from { packages } and from pnpm-workspace.yaml', () => {
    const object = JSON.stringify({ workspaces: { packages: ['libs/*'] } });
    expect(declaredWorkspaces((rel) => (rel === 'package.json' ? object : null))).toEqual(['libs/*']);

    const pnpm = "packages:\n  - 'apps/*'\n  - packages/*\n";
    const read = (rel: string): string | null =>
      rel === 'pnpm-workspace.yaml' ? pnpm : rel === 'package.json' ? '{"name":"root"}' : null;
    expect(declaredWorkspaces(read)).toEqual(['apps/*', 'packages/*']);
    expect(declaredWorkspaces(() => null)).toEqual([]);
  });

  test('skips an unparsable manifest instead of throwing', () => {
    expect(
      run({
        'apps/web/package.json': '{ not json',
        'apps/api/package.json': manifest('api', { typescript: '5.7.2' }),
      }),
    ).toEqual([]);
  });

  test('ciCritical defaults to true and can be turned off', () => {
    expect(createSharedToolVersionParityRule().ciCritical).toBe(true);
    expect(createSharedToolVersionParityRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  describe('on a real tree', () => {
    const fixture = createFixture({
      'package.json': JSON.stringify({ name: 'root', private: true }),
      'apps/web/package.json': manifest('web', { typescript: '5.6.3' }),
      'apps/api/package.json': manifest('api', { typescript: '5.7.2' }),
      'packages/ui/package.json': manifest('ui', { typescript: '5.7.2' }),
    });

    test('reads pnpm-workspace.yaml from disk and reports the drift', () => {
      const violations = runSync(createSharedToolVersionParityRule(), fixture.context());

      expect(violations.map((violation) => violation.file)).toEqual([
        'apps/api/package.json',
        'apps/web/package.json',
        'packages/ui/package.json',
      ]);
    });
  });
});
