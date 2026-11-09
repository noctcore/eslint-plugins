import { readFileSync, statSync } from 'node:fs';

/** A per-file cache that re-reads a file whenever its modification time moves. */
export interface FileCache<T> {
  /**
   * The parsed contents of `file`, or `undefined` when it is missing, is not a
   * regular file, or cannot be read. Parsed again only when the mtime changed.
   */
  get(file: string): T | undefined;
  /** Drop every cached entry. */
  clear(): void;
}

/**
 * Build a cache for rules that read other files (a schema, a catalog, an
 * imported helper). The ESLint server in an editor lives for hours, so a cache
 * keyed on the path alone would keep reporting against a file the user already
 * fixed; this one is keyed on path and mtime.
 *
 * `parse` receives the file's UTF-8 text. It should not throw: return a value
 * that records the failure (for example `null` or `{ ok: false }`) so the
 * failure is cached at that mtime too.
 *
 * ```ts
 * const schemas = createFileCache((text) => parseDeclaredKeys(text));
 * const keys = schemas.get(path.resolve(cwd, schemaPath)); // undefined: unreadable
 * ```
 */
export function createFileCache<T>(parse: (text: string, file: string) => T): FileCache<T> {
  const entries = new Map<string, { readonly mtimeMs: number; readonly value: T }>();
  return {
    get(file) {
      let mtimeMs: number;
      try {
        const stats = statSync(file);
        if (!stats.isFile()) {
          entries.delete(file);
          return undefined;
        }
        mtimeMs = stats.mtimeMs;
      } catch {
        entries.delete(file);
        return undefined;
      }
      const cached = entries.get(file);
      if (cached !== undefined && cached.mtimeMs === mtimeMs) {
        return cached.value;
      }
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        entries.delete(file);
        return undefined;
      }
      const value = parse(text, file);
      entries.set(file, { mtimeMs, value });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
