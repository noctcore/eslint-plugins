import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-unexported-subpath-import';

export interface NoUnexportedSubpathImportOptions {
  /**
   * npm scopes whose workspace packages have their `exports` map enforced, e.g.
   * `['@acme']`. REQUIRED — there is no default scope, so with no scopes the
   * rule matches nothing and never fires in a repo that has not opted in.
   */
  readonly scopes: readonly string[];
}

type RuleOptions = [NoUnexportedSubpathImportOptions];
type MessageIds = 'subpathNotExported';

/*
 * Importing `@scope/pkg/deep/subpath` only works if the target workspace package
 * actually maps that subpath in its `package.json` `exports`. Under Node's
 * modern resolution, an unexported subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * at runtime — but tooling that resolves through TypeScript paths or a bundler
 * alias can hide that until production. This rule reads the target package's
 * `exports` from disk and reports a subpath the package does not expose.
 *
 * Conservative by construction — it only reports when it is *sure*:
 *   - the specifier is `@scope/pkg/<subpath>` for a configured scope,
 *   - the target package is found in the workspace,
 *   - that package declares an `exports` map, AND
 *   - the requested subpath matches no entry in it (exact, wildcard `*`, or the
 *     deprecated trailing-slash folder form; an entry mapped to `null` is a block).
 * If the workspace, the package, or its `exports` cannot be resolved, the rule
 * stays silent rather than guess. `@scope/pkg` (the barrel) and
 * `@scope/pkg/package.json` are always allowed.
 *
 * Package resolution walks up from the importing file to the nearest workspace
 * root (a `package.json` with a `workspaces` field, or a `pnpm-workspace.yaml`),
 * then indexes the workspace packages by name. Directory listings and parsed
 * `exports` maps are cached per lint run.
 */
const DEFAULT_WORKSPACE_GLOBS: readonly string[] = ['packages/*', 'apps/*', 'libs/*'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['scopes'],
  properties: {
    scopes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

interface ParsedScoped {
  readonly pkg: string;
  readonly subpath: string;
}

/** A `@scope/pkg/<subpath>` specifier for a configured scope, else `null`. */
function parseScoped(source: string, scopes: readonly string[]): ParsedScoped | null {
  for (const scope of scopes) {
    const prefix = `${scope}/`;
    if (!source.startsWith(prefix)) {
      continue;
    }
    const rest = source.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      return null; // `@scope/pkg` — the barrel.
    }
    const name = rest.slice(0, slash);
    const subpath = rest.slice(slash + 1);
    if (name === '' || subpath === '') {
      return null;
    }
    return { pkg: `${scope}/${name}`, subpath };
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

// ---- exports-map matching ---------------------------------------------------

/**
 * True when an `exports` value exposes the request subpath (`.` or `./x/y`).
 * Handles the shapes a lint rule needs: a bare string / conditions object (only
 * `.` is exported), a subpath map with exact keys, `*` wildcard patterns, and
 * the deprecated trailing-slash folder form. A key mapped to `null` is a block.
 */
function subpathExposed(exp: unknown, req: string): boolean {
  if (typeof exp === 'string') {
    return req === '.';
  }
  if (Array.isArray(exp)) {
    return exp.some((entry) => subpathExposed(entry, req));
  }
  if (!isPlainObject(exp)) {
    return false;
  }

  const keys = Object.keys(exp);
  const hasSubpaths = keys.some((key) => key === '.' || key.startsWith('./'));
  if (!hasSubpaths) {
    // A conditions-only object (`import`/`require`/`default`/…) is the `.` export.
    return req === '.';
  }

  if (Object.prototype.hasOwnProperty.call(exp, req)) {
    return exp[req] !== null; // exact match; null = explicit block.
  }

  let matched = false;
  for (const key of keys) {
    if (!key.startsWith('./')) {
      continue;
    }
    const val = exp[key];
    if (key.endsWith('/')) {
      // Deprecated folder mapping: `./features/` covers `./features/anything`.
      if (req.startsWith(key) && req.length > key.length) {
        if (val === null) {
          return false;
        }
        matched = true;
      }
    } else if (key.includes('*')) {
      const star = key.indexOf('*');
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (
        req.startsWith(prefix) &&
        req.endsWith(suffix) &&
        req.length >= prefix.length + suffix.length
      ) {
        if (val === null) {
          return false;
        }
        matched = true;
      }
    }
  }
  return matched;
}

// ---- workspace resolution (cached per lint run) -----------------------------

interface WorkspaceRoot {
  readonly root: string;
  readonly globs: readonly string[];
}

const rootCache = new Map<string, WorkspaceRoot | null>();
const indexCache = new Map<string, ReadonlyMap<string, string>>();
const exportsCache = new Map<string, { readonly hasExports: boolean; readonly exports: unknown }>();

/** Workspace globs declared by a root `package.json`, or `null` if it is not a root. */
function workspaceGlobsFromPkg(pkg: unknown): string[] | null {
  if (!isPlainObject(pkg)) {
    return null;
  }
  const ws = pkg['workspaces'];
  if (Array.isArray(ws)) {
    return ws.filter((entry): entry is string => typeof entry === 'string');
  }
  if (isPlainObject(ws) && Array.isArray(ws['packages'])) {
    return ws['packages'].filter((entry): entry is string => typeof entry === 'string');
  }
  return null;
}

/** Best-effort package globs from a `pnpm-workspace.yaml` (light line parse). */
function globsFromPnpm(file: string): readonly string[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return DEFAULT_WORKSPACE_GLOBS;
  }
  const globs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      globs.push(match[1].trim());
    }
  }
  return globs.length > 0 ? globs : DEFAULT_WORKSPACE_GLOBS;
}

function findWorkspaceRoot(startDir: string): WorkspaceRoot | null {
  const cached = rootCache.get(startDir);
  if (cached !== undefined) {
    return cached;
  }

  let result: WorkspaceRoot | null = null;
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const globs = workspaceGlobsFromPkg(readJson(pkgPath));
      if (globs !== null) {
        result = { root: dir, globs };
        break;
      }
    }
    const pnpmPath = path.join(dir, 'pnpm-workspace.yaml');
    if (existsSync(pnpmPath)) {
      result = { root: dir, globs: globsFromPnpm(pnpmPath) };
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  rootCache.set(startDir, result);
  return result;
}

/** Candidate package directories a single (single-level) workspace glob points at. */
function candidateDirs(root: string, glob: string): string[] {
  const normalized = glob.split('\\').join('/');
  const starIdx = normalized.indexOf('*');
  if (starIdx === -1) {
    return [path.join(root, normalized)];
  }
  const beforeStar = normalized.slice(0, starIdx);
  const parentRel = beforeStar.endsWith('/')
    ? beforeStar.slice(0, -1)
    : path.dirname(beforeStar);
  const parentDir = path.join(root, parentRel);
  try {
    return readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parentDir, entry.name));
  } catch {
    return [];
  }
}

/** Map of workspace package name → package directory, cached per root. */
function packageIndex(ws: WorkspaceRoot): ReadonlyMap<string, string> {
  const cached = indexCache.get(ws.root);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, string>();
  for (const glob of ws.globs) {
    for (const dir of candidateDirs(ws.root, glob)) {
      const pkg = readJson(path.join(dir, 'package.json'));
      if (isPlainObject(pkg) && typeof pkg['name'] === 'string' && !index.has(pkg['name'])) {
        index.set(pkg['name'], dir);
      }
    }
  }
  indexCache.set(ws.root, index);
  return index;
}

/** The `exports` map of a package directory (cached), and whether one exists. */
function packageExports(pkgDir: string): { hasExports: boolean; exports: unknown } {
  const cached = exportsCache.get(pkgDir);
  if (cached !== undefined) {
    return cached;
  }
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  const result = isPlainObject(pkg) && 'exports' in pkg
    ? { hasExports: true, exports: pkg['exports'] }
    : { hasExports: false, exports: undefined };
  exportsCache.set(pkgDir, result);
  return result;
}

function literalString(node: TSESTree.Node | null | undefined): string | null {
  return node !== null && node !== undefined && node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

export const noUnexportedSubpathImportRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "Importing a `@scope/pkg/<subpath>` that the target workspace package's `exports` map does not expose. Reads the target `package.json` from disk.",
    },
    schema: [optionSchema],
    messages: {
      subpathNotExported:
        "`{{source}}` imports `{{subpath}}`, which `{{pkg}}` does not expose in its `exports` map. Import a public subpath, or add `{{subpath}}` to that package's `exports`.",
    },
  },
  defaultOptions: [{ scopes: [] }],
  create(context, [options]) {
    const scopes = options.scopes;
    if (scopes.length === 0) {
      return {};
    }
    const startDir = path.dirname(context.filename);

    function check(node: TSESTree.Node, source: string | null): void {
      if (source === null) {
        return;
      }
      const parsed = parseScoped(source, scopes);
      if (parsed === null || parsed.subpath === 'package.json') {
        return; // barrel, non-configured scope, or always-allowed package.json.
      }
      const ws = findWorkspaceRoot(startDir);
      if (ws === null) {
        return; // no workspace to resolve against — stay silent.
      }
      const pkgDir = packageIndex(ws).get(parsed.pkg);
      if (pkgDir === undefined) {
        return; // target package not found — stay silent.
      }
      const { hasExports, exports } = packageExports(pkgDir);
      if (!hasExports) {
        return; // no `exports` map means subpaths are unrestricted.
      }
      const req = `./${parsed.subpath}`;
      if (!subpathExposed(exports, req)) {
        context.report({
          node,
          messageId: 'subpathNotExported',
          data: { source, pkg: parsed.pkg, subpath: req },
        });
      }
    }

    return {
      ImportDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ExportNamedDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ExportAllDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ImportExpression(node): void {
        check(node, literalString(node.source));
      },
    };
  },
});
