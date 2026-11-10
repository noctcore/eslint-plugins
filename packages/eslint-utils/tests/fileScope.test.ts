import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  fileMatchesAnyGlob,
  fileScopeCandidates,
  findRepoRoot,
  relativeInside,
  resolveAllowIn,
} from '../src/fileScope';
import { toPosixPath } from '../src/glob';

describe('relativeInside', () => {
  it.each([
    ['/repo/apps/server/env.ts', '/repo', 'apps/server/env.ts'],
    ['/repo/apps/server/env.ts', '/repo/', 'apps/server/env.ts'],
    ['/repo/x.ts', '/', 'repo/x.ts'],
    ['/repository/x.ts', '/repo', null],
    ['/other/x.ts', '/repo', null],
    ['/repo', '/repo', null],
    ['C:\\repo\\apps\\server\\env.ts', 'C:\\repo', 'apps/server/env.ts'],
    ['c:\\repo\\apps\\env.ts', 'C:\\repo', 'apps/env.ts'],
    ['D:\\repo\\apps\\env.ts', 'C:\\repo', null],
  ])('%s inside %s is %s', (file, dir, expected) => {
    expect(relativeInside(file, dir)).toBe(expected);
  });
});

describe('fileMatchesAnyGlob', () => {
  it('matches a repo-relative glob against the path relative to cwd (POSIX)', () => {
    expect(fileMatchesAnyGlob('/work/repo/apps/server/env.ts', ['apps/server/**'], '/work/repo')).toBe(true);
  });

  it('matches a repo-relative glob against the path relative to cwd (Windows)', () => {
    expect(fileMatchesAnyGlob('C:\\work\\repo\\apps\\server\\env.ts', ['apps/server/**'], 'C:\\work\\repo')).toBe(
      true,
    );
  });

  it('accepts a leading ./ on a relative glob', () => {
    expect(fileMatchesAnyGlob('/work/repo/scripts/seed.ts', ['./scripts/**'], '/work/repo')).toBe(true);
  });

  it('keeps matching an absolute or **/-anchored glob', () => {
    expect(fileMatchesAnyGlob('/work/repo/apps/server/env.ts', ['**/apps/server/**'], '/elsewhere')).toBe(true);
    expect(fileMatchesAnyGlob('C:\\work\\repo\\tools\\cli.ts', ['**/tools/**'])).toBe(true);
    expect(fileMatchesAnyGlob('/work/repo/a.ts', ['/work/repo/*.ts'])).toBe(true);
  });

  it('does not match a relative glob for a file outside cwd', () => {
    expect(fileMatchesAnyGlob('/other/apps/server/env.ts', ['apps/server/**'], '/work/repo')).toBe(false);
  });

  it('does not match a relative glob against the absolute path alone', () => {
    expect(fileMatchesAnyGlob('/no-root-here/apps/server/env.ts', ['apps/server/**'])).toBe(false);
  });

  it('matches nothing with an empty pattern list', () => {
    expect(fileMatchesAnyGlob('/work/repo/a.ts', [], '/work/repo')).toBe(false);
  });
});

describe('workspace root resolution', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'noctcore-file-scope-'));
  const pkg = path.join(root, 'packages', 'api');
  mkdirSync(path.join(pkg, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
  const file = path.join(pkg, 'src', 'env.ts');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the nearest ancestor holding a lockfile', () => {
    expect(findRepoRoot(path.dirname(file))).toBe(root);
  });

  it('matches a root-relative glob when cwd is a workspace package', () => {
    expect(fileMatchesAnyGlob(file, ['packages/api/src/**'], pkg)).toBe(true);
    expect(fileMatchesAnyGlob(file, ['src/**'], pkg)).toBe(true);
  });

  it('lists the absolute, cwd-relative and root-relative spellings once each', () => {
    expect(fileScopeCandidates(file, pkg)).toEqual([toPosixPath(file), 'src/env.ts', 'packages/api/src/env.ts']);
    expect(fileScopeCandidates(file, root)).toEqual([toPosixPath(file), 'packages/api/src/env.ts']);
  });
});

describe('resolveAllowIn', () => {
  const defaults = ['**/scripts/**'];

  it('returns the defaults when neither allowIn nor an alias is set', () => {
    expect(resolveAllowIn({}, ['allowedFiles'], defaults)).toBe(defaults);
  });

  it('reads allowIn', () => {
    expect(resolveAllowIn({ allowIn: ['a/**'] }, ['allowedFiles'], defaults)).toEqual(['a/**']);
  });

  it('reads a deprecated alias', () => {
    expect(resolveAllowIn({ allowedFiles: ['b/**'] }, ['allowedFiles'], defaults)).toEqual(['b/**']);
  });

  it('combines allowIn and an alias, without duplicates', () => {
    expect(resolveAllowIn({ allowIn: ['a/**', 'b/**'], ignore: ['b/**', 'c/**'] }, ['ignore'], defaults)).toEqual([
      'a/**',
      'b/**',
      'c/**',
    ]);
  });

  it('treats an empty allowIn as set, so it exempts nothing', () => {
    expect(resolveAllowIn({ allowIn: [] }, ['allowedFiles'], defaults)).toEqual([]);
  });

  it('ignores keys that are not listed as aliases', () => {
    expect(resolveAllowIn({ include: ['x/**'] }, ['ignore'], defaults)).toBe(defaults);
  });
});
