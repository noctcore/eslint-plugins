import type { IMetaCtx } from '@noctcore/harness';

export interface FakeFiles {
  [rel: string]: string | null;
}

export interface CreateFakeCtxOptions {
  files?: FakeFiles;
  root?: string;
  /** Optional `exec` stub; defaults to a benign `{ code: 0 }`. */
  exec?: IMetaCtx['exec'];
}

/**
 * Minimal glob for the fake ctx, faithful enough to Bun's `Glob` for these
 * rules:
 *  - a `/` + `**` + `/` sequence matches zero OR more directory segments (so a
 *    `src/**` + `/*.ts` glob matches both `src/a.ts` and `src/deep/a.ts`),
 *  - a standalone `**` matches anything,
 *  - `*` matches within a single segment, and
 *  - `[...]` character classes (e.g. `[A-Z]`) pass through untouched —
 *    `ui-primitive-shape` globs `[A-Z]*.tsx`, so brackets must NOT be escaped.
 *
 * The `__NC_*__` tokens stash the `**` expansions so the single-`*` pass cannot
 * re-mangle the multi-segment regex they expand to.
 */
function matchesGlob(candidate: string, pattern: string): boolean {
  const re = pattern
    // Escape regex specials EXCEPT `*` (wildcards) and `[` `]` `-` (char classes).
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '__NC_DIRS__')
    .replace(/\*\*/g, '__NC_ANY__')
    .replace(/\*/g, '[^/]*')
    .replaceAll('__NC_DIRS__', '/(?:.*/)?')
    .replaceAll('__NC_ANY__', '.*');
  return new RegExp('^' + re + '$').test(candidate);
}

/** Build an in-memory {@link IMetaCtx} over a synthetic `rel → content` map. */
export function createFakeCtx(opts: CreateFakeCtxOptions = {}): IMetaCtx {
  const fileMap: FakeFiles = opts.files ?? {};
  const root = opts.root ?? '/fake-repo';

  return {
    root,
    read(rel: string): string | null {
      const v = fileMap[rel];
      return v === undefined || v === null ? null : v;
    },
    exists(rel: string): boolean {
      return rel in fileMap && fileMap[rel] !== null;
    },
    glob(pattern: string): string[] {
      return Object.keys(fileMap).filter((p) => matchesGlob(p, pattern));
    },
    exec: opts.exec ?? (() => ({ code: 0, stdout: '', stderr: '' })),
  };
}
