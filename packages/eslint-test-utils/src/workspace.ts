import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let root: string | undefined;

/**
 * An absolute path inside a throwaway workspace root (a temp directory holding
 * a `pnpm-lock.yaml`), created once per process. RuleTester runs rules with
 * `context.cwd` set to `/`, so a test of a repo-relative file-scope glob such as
 * `apps/server/**` needs a file under a real workspace root to match against.
 * The file itself is not created.
 */
export function workspacePath(...segments: string[]): string {
  if (root === undefined) {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'noctcore-workspace-')));
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
  }
  return path.join(root, ...segments);
}
