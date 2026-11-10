import { statSync } from 'node:fs';
import path from 'node:path';

import { createFileCache } from '@noctcore/eslint-utils';

/**
 * Translation catalog loading for the i18n rules.
 *
 * A catalog is a JSON file (or a subtree of one) that holds the keys of ONE
 * namespace. Projects lay catalogs out in a handful of shapes, and a
 * `CatalogSource` describes each of them without the rule knowing any project:
 *
 *   one file per namespace   `{ file: 'locales/en/{ns}.json' }`
 *   one file, ns at the top  `{ file: 'locales/en.json', keyPath: '{ns}' }`
 *   a fixed file for one ns  `{ file: 'src/i18n/en.json', namespace: 'common' }`
 *   single-namespace app     `{ file: 'src/i18n/en.json' }` (the default namespace)
 *
 * `{ns}` is substituted with the namespace being resolved. A templated source
 * whose file or subtree does not exist simply does not supply that namespace;
 * a FIXED source that cannot be read is a configuration error and is surfaced.
 */
export interface CatalogSource {
  /** JSON catalog path, relative to the ESLint cwd. May contain `{ns}`. */
  readonly file: string;
  /** Namespace a fixed (non-templated) source supplies. Defaults to the default namespace. */
  readonly namespace?: string;
  /** Dot-separated subtree inside the file holding the namespace's keys. May contain `{ns}`. */
  readonly keyPath?: string;
}

/** The flattened key space of one namespace catalog. */
export interface Catalog {
  /** Where the keys came from, for messages: `file` or `file#keyPath`. */
  readonly label: string;
  /** Every leaf key (a string / number / boolean value), joined by the key separator. */
  readonly leaves: ReadonlySet<string>;
  /** Every non-leaf key (an object or array), joined by the key separator. */
  readonly branches: ReadonlySet<string>;
}

/** Outcome of resolving one namespace against every configured source. */
export interface NamespaceCatalogs {
  readonly catalogs: readonly Catalog[];
  /** Fixed sources that should supply this namespace but could not be loaded. */
  readonly errors: readonly string[];
}

const NS_PLACEHOLDER = '{ns}';

/** A namespace that is safe to substitute into a path: one segment, no traversal. */
const SAFE_NAMESPACE = /^(?!\.{1,2}$)[^/\\\0]+$/u;

interface IParsedFile {
  /** Parsed JSON, or the reason it could not be parsed. */
  readonly value: { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly reason: string };
  /** Flattened catalogs of this file, keyed by `keyPath\0keySeparator`. */
  readonly flattened: Map<string, Catalog | null>;
}

// Absolute path -> parsed file, keyed on path and mtime so an editor session
// sees catalog edits without restarting the ESLint server. The flattened
// catalogs live inside the entry, so they are dropped with it.
const fileCache = createFileCache<IParsedFile>((text) => {
  let value: IParsedFile['value'];
  try {
    value = { ok: true, json: JSON.parse(text) as unknown };
  } catch (error) {
    value = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { value, flattened: new Map() };
});

type FileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'ok'; readonly entry: IParsedFile };

/** True when `absolute` is a regular file, readable or not. */
function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function readCatalogFile(absolute: string): FileRead {
  const entry = fileCache.get(absolute);
  if (entry === undefined) {
    // The shared cache answers `undefined` for a missing file and for one it
    // could not read. A catalog that exists but cannot be read is a broken
    // configuration, not an absent namespace, so it stays loud.
    return isFile(absolute) ? { kind: 'invalid', reason: 'the file cannot be read' } : { kind: 'missing' };
  }
  return entry.value.ok ? { kind: 'ok', entry } : { kind: 'invalid', reason: entry.value.reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Walk a dot-separated config path; `undefined` when any segment is absent. */
function descend(json: unknown, keyPath: string | undefined): unknown {
  if (keyPath === undefined || keyPath === '') return json;
  let current: unknown = json;
  for (const segment of keyPath.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Flatten a catalog subtree into leaf and branch keys. With `keySeparator:
 * false` i18next reads keys flat, so only the top level is addressable.
 */
function flatten(root: Record<string, unknown>, keySeparator: string | false, label: string): Catalog {
  const leaves = new Set<string>();
  const branches = new Set<string>();
  const visit = (value: unknown, prefix: string): void => {
    if (!isRecord(value)) {
      leaves.add(prefix);
      return;
    }
    branches.add(prefix);
    if (keySeparator === false) return;
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${prefix}${keySeparator}${key}`);
    }
  };
  for (const [key, child] of Object.entries(root)) {
    if (keySeparator === false) {
      (isRecord(child) ? branches : leaves).add(key);
    } else {
      visit(child, key);
    }
  }
  return { label, leaves, branches };
}

type SourceLoad =
  | { readonly kind: 'absent' }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'ok'; readonly catalog: Catalog };

function loadSource(
  cwd: string,
  file: string,
  keyPath: string | undefined,
  keySeparator: string | false,
): SourceLoad {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const read = readCatalogFile(absolute);
  if (read.kind === 'missing') return { kind: 'absent' };
  if (read.kind === 'invalid') return { kind: 'error', reason: `${file}: ${read.reason}` };
  const cacheKey = `${keyPath ?? ''}\0${keySeparator === false ? '' : keySeparator}`;
  const cached = read.entry.flattened.get(cacheKey);
  if (cached !== undefined) {
    return cached === null ? { kind: 'absent' } : { kind: 'ok', catalog: cached };
  }
  const subtree = read.entry.value.ok ? descend(read.entry.value.json, keyPath) : undefined;
  const label = keyPath ? `${file}#${keyPath}` : file;
  const catalog = isRecord(subtree) ? flatten(subtree, keySeparator, label) : null;
  read.entry.flattened.set(cacheKey, catalog);
  return catalog === null ? { kind: 'absent' } : { kind: 'ok', catalog };
}

/** Every catalog the configured sources supply for `namespace`, in source order. */
export function catalogsForNamespace(
  namespace: string,
  sources: readonly CatalogSource[],
  settings: { readonly cwd: string; readonly defaultNamespace: string; readonly keySeparator: string | false },
): NamespaceCatalogs {
  const catalogs: Catalog[] = [];
  const errors: string[] = [];
  for (const source of sources) {
    const templated = source.file.includes(NS_PLACEHOLDER) || (source.keyPath?.includes(NS_PLACEHOLDER) ?? false);
    if (templated) {
      if (!SAFE_NAMESPACE.test(namespace)) continue;
      const file = source.file.replaceAll(NS_PLACEHOLDER, namespace);
      const keyPath = source.keyPath?.replaceAll(NS_PLACEHOLDER, namespace);
      const load = loadSource(settings.cwd, file, keyPath, settings.keySeparator);
      // A templated source that has no file / subtree for this namespace just
      // does not supply it; only a file that exists but will not parse is loud.
      if (load.kind === 'ok') catalogs.push(load.catalog);
      else if (load.kind === 'error') errors.push(load.reason);
      continue;
    }
    if ((source.namespace ?? settings.defaultNamespace) !== namespace) continue;
    const load = loadSource(settings.cwd, source.file, source.keyPath, settings.keySeparator);
    if (load.kind === 'ok') catalogs.push(load.catalog);
    else if (load.kind === 'error') errors.push(load.reason);
    else {
      const where = source.keyPath ? `${source.file}#${source.keyPath}` : source.file;
      errors.push(`${where}: not found or not a JSON object`);
    }
  }
  return { catalogs, errors };
}

/** CLDR plural categories i18next appends to a key (`key_one`, `key_ordinal_few`). */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export interface KeyLookup {
  /** Plural forms may answer for the key (the call passes, or may pass, `count`). */
  readonly plural: boolean;
  /** Context variants may answer for the key (the call passes, or may pass, `context`). */
  readonly context: boolean;
  /** The call asks for an object (`returnObjects`), so a branch answers too. */
  readonly returnObjects: boolean;
  readonly pluralSeparator: string;
  readonly contextSeparator: string;
}

/** Does `key` resolve in `catalog` the way i18next would look it up? */
export function catalogHasKey(catalog: Catalog, key: string, lookup: KeyLookup): boolean {
  if (catalog.leaves.has(key)) return true;
  if (lookup.returnObjects && catalog.branches.has(key)) return true;
  if (lookup.plural) {
    const sep = lookup.pluralSeparator;
    for (const category of PLURAL_CATEGORIES) {
      if (catalog.leaves.has(`${key}${sep}${category}`)) return true;
      if (catalog.leaves.has(`${key}${sep}ordinal${sep}${category}`)) return true;
    }
  }
  if (lookup.context) {
    // Context values are open-ended (`friend_male`, `friend_male_one`), so any
    // variant of the key counts once the call carries a context.
    const variant = `${key}${lookup.contextSeparator}`;
    for (const leaf of catalog.leaves) {
      if (leaf.startsWith(variant)) return true;
    }
  }
  return false;
}

/** Does any key in `catalog` start with `prefix`? (the `dynamicKeys: 'check-prefix'` probe) */
export function catalogHasPrefix(catalog: Catalog, prefix: string): boolean {
  for (const leaf of catalog.leaves) {
    if (leaf.startsWith(prefix)) return true;
  }
  for (const branch of catalog.branches) {
    if (branch.startsWith(prefix)) return true;
  }
  return false;
}
