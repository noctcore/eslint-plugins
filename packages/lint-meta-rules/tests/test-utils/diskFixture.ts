import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import { afterAll } from 'bun:test';

/** A repository written to a real temp directory, with a ctx that reads it from disk. */
export interface DiskFixture {
  /** Absolute path of the fixture repository root. */
  readonly root: string;
  /** Write (or overwrite) files, keyed by repo-relative POSIX path. */
  readonly write: (files: Readonly<Record<string, string>>) => void;
  /** A ctx over the files on disk, as the harness builds one. */
  readonly context: () => IMetaCtx;
}

/**
 * A ctx that reads `root` from disk: `read` and `exists` hit the filesystem and
 * `glob` is Node's `globSync`, so a rule sees the tree a real run would, not a
 * map that matches whatever a test hands it. Like the harness, `read` returns
 * null for a missing file and throws on a directory.
 */
export function diskCtx(root: string): IMetaCtx {
  return {
    root,
    read(rel) {
      const absolute = path.join(root, rel);
      if (!existsSync(absolute)) return null;
      return readFileSync(absolute, 'utf8').replace(/\r\n/gu, '\n');
    },
    exists(rel) {
      return existsSync(path.join(root, rel));
    },
    glob(pattern) {
      return globSync(pattern, { cwd: root })
        .map((rel) => rel.split(path.sep).join('/'))
        .filter((rel) => statSync(path.join(root, rel)).isFile())
        .sort();
    },
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
}

/**
 * A fresh fixture repository, removed after the enclosing suite. It starts with
 * a `pnpm-workspace.yaml` listing `apps/*` and `packages/*`, as a pnpm monorepo
 * would have; pass your own to replace it.
 */
export function createFixture(files: Readonly<Record<string, string>> = {}): DiskFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'lint-meta-fixture-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const write = (entries: Readonly<Record<string, string>>): void => {
    for (const [rel, content] of Object.entries(entries)) {
      const absolute = path.join(root, ...rel.split('/'));
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  };
  write({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n", ...files });
  return { root, write, context: () => diskCtx(root) };
}

/** Run a rule's sync pass; a rule without one fails the test loudly. */
export function runSync(rule: IMetaRule, ctx: IMetaCtx): IViolation[] {
  if (rule.run === undefined) throw new Error(`Rule "${rule.id}" has no sync pass`);
  return rule.run(ctx);
}

/** The messages of a violation list, in order. */
export function messages(violations: readonly IViolation[]): string[] {
  return violations.map((violation) => violation.message);
}
