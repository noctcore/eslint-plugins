import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_SYSTEM_FILES,
  findRepoRoot,
  globToRegExp,
  isAllowlisted,
  toRepoRelative,
} from '../../src/utils/allowlist';

/*
 * The allowlist touches the filesystem (it walks up to a workspace root), so
 * these tests run against REAL directories: this checkout, and throwaway trees
 * under the OS temp dir. A fake context would pass whatever the walk did.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..', '..', '..');

const scratch = mkdtempSync(path.join(tmpdir(), 'noctcore-prisma-allowlist-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function tree(name: string, files: readonly string[]): string {
  const root = path.join(scratch, name);
  for (const file of files) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '');
  }
  return root;
}

describe('globToRegExp', () => {
  it('lets a leading globstar match zero or more directories', () => {
    expect(globToRegExp('**/prisma/seed.ts').test('prisma/seed.ts')).toBe(true);
    expect(globToRegExp('**/prisma/seed.ts').test('/abs/packages/db/prisma/seed.ts')).toBe(true);
    expect(globToRegExp('**/prisma/seed.ts').test('/abs/prisma/seed.tsx')).toBe(false);
  });

  it('keeps a single star inside one segment', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/nested/a.ts')).toBe(false);
  });

  it('supports brace alternation and escapes regex metacharacters', () => {
    expect(globToRegExp('**/seed.{ts,js}').test('x/seed.js')).toBe(true);
    expect(globToRegExp('**/a+b.ts').test('x/a+b.ts')).toBe(true);
    expect(globToRegExp('**/a+b.ts').test('x/aab.ts')).toBe(false);
  });

  it('matches through dot-directories and dotfiles', () => {
    expect(globToRegExp('**/prisma/migrations/**').test('/r/.config/prisma/migrations/0001/m.sql')).toBe(
      true,
    );
    expect(globToRegExp('**/*.seed.ts').test('/r/.seeds/.local.seed.ts')).toBe(true);
  });
});

describe('findRepoRoot', () => {
  it('finds this checkout by its real lockfile', () => {
    expect(findRepoRoot(path.dirname(THIS_FILE))).toBe(REPO_ROOT);
  });

  it.each(['pnpm-workspace.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'])(
    'treats %s as a workspace root marker',
    (marker) => {
      const root = tree(`marker-${marker}`, [marker, 'packages/api/src/deep/file.ts']);
      expect(findRepoRoot(path.join(root, 'packages/api/src/deep'))).toBe(root);
    },
  );

  it('returns the nearest root, not an outer one', () => {
    const outer = tree('nested', ['pnpm-lock.yaml', 'inner/yarn.lock', 'inner/src/a.ts']);
    expect(findRepoRoot(path.join(outer, 'inner/src'))).toBe(path.join(outer, 'inner'));
  });
});

describe('isAllowlisted', () => {
  it('allowlists nothing with an empty list', () => {
    expect(isAllowlisted('/r/prisma/seed.ts', [])).toBe(false);
  });

  it('matches the shipped defaults on absolute paths', () => {
    for (const file of [
      '/r/packages/database/prisma/seed.ts',
      '/r/apps/api/src/users.seed.ts',
      '/r/prisma/migrations/20260101_init/migration.sql',
      '/r/apps/api/src/tenancy.isolation.spec.ts',
    ]) {
      expect(isAllowlisted(file, DEFAULT_SYSTEM_FILES), file).toBe(true);
    }
    expect(isAllowlisted('/r/apps/api/src/users.service.ts', DEFAULT_SYSTEM_FILES)).toBe(false);
  });

  it('matches a root-anchored glob against the workspace-relative path', () => {
    const root = tree('anchored', ['pnpm-workspace.yaml', 'packages/database/src/client.ts']);
    const file = path.join(root, 'packages/database/src/client.ts');
    expect(toRepoRelative(file)).toBe('packages/database/src/client.ts');
    expect(isAllowlisted(file, ['packages/database/**'])).toBe(true);
    expect(isAllowlisted(file, ['packages/api/**'])).toBe(false);
  });

  it('matches a root-anchored glob under a dot-directory on a real tree', () => {
    const root = tree('dotdir', ['bun.lock', '.internal/ops/sweep.ts']);
    expect(isAllowlisted(path.join(root, '.internal/ops/sweep.ts'), ['.internal/**'])).toBe(true);
  });
});
