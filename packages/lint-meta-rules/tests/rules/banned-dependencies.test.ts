import { describe, expect, test } from 'bun:test';

import { createBannedDependenciesRule } from '../../src/rules/banned-dependencies';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const banned = {
  axios: 'Use the platform `fetch` instead.',
  '@react-email/ui': 'It pulls in next and its advisories; the preview CLI offers to reinstall it.',
};

const manifest = (deps: Record<string, Record<string, string>>): string =>
  JSON.stringify({ name: 'fixture', ...deps }, null, 2);

describe('banned-dependencies', () => {
  test('reports a banned package in any dependency field of any workspace, with its reason', () => {
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest({ devDependencies: { axios: '^1.7.0' } }),
        'apps/email/package.json': manifest({ dependencies: { '@react-email/ui': '^4.0.0', react: '^19.0.0' } }),
      },
    });
    const violations = createBannedDependenciesRule({ banned }).run?.(ctx) ?? [];

    expect(violations.map((v) => v.file)).toEqual(['apps/email/package.json', 'package.json']);
    expect(violations[0]?.message).toContain('`@react-email/ui` is banned from this repo but appears in dependencies');
    expect(violations[1]?.message).toContain('appears in devDependencies. Use the platform `fetch` instead.');
  });

  test('reports nothing until a package is banned', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest({ dependencies: { axios: '^1.7.0' } }) } });
    expect(createBannedDependenciesRule().run?.(ctx)).toEqual([]);
  });

  test('passes clean manifests and skips one that is not JSON', () => {
    const ctx = createFakeCtx({
      files: {
        'package.json': manifest({ dependencies: { react: '^19.0.0' } }),
        'packages/broken/package.json': '{ not json',
      },
    });
    expect(createBannedDependenciesRule({ banned }).run?.(ctx)).toEqual([]);
  });

  test('ignores manifests outside the globs, such as node_modules', () => {
    const ctx = createFakeCtx({
      files: { 'node_modules/x/package.json': manifest({ dependencies: { axios: '1.0.0' } }) },
    });
    const rule = createBannedDependenciesRule({ banned, manifestGlobs: ['**/package.json'] });
    expect(rule.run?.(ctx)).toEqual([]);
  });

  test('reads only the configured fields', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest({ peerDependencies: { axios: '*' } }) } });
    expect(createBannedDependenciesRule({ banned, dependencyFields: ['dependencies'] }).run?.(ctx)).toEqual([]);
    expect(createBannedDependenciesRule({ banned }).run?.(ctx)).toHaveLength(1);
  });

  test('does not read an inherited object key as a banned name', () => {
    const ctx = createFakeCtx({ files: { 'package.json': manifest({ dependencies: { constructor: '1.0.0' } }) } });
    expect(createBannedDependenciesRule({ banned }).run?.(ctx)).toEqual([]);
  });
});
