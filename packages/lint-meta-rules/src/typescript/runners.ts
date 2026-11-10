import type { IMetaCtx } from '@noctcore/harness';
import ts from 'typescript';

import { dirName, joinRelative, matchesAnyGlob, normalizeRelative } from '../rules/glob-match';
import { asRecord, DEFAULT_SKIP_DIRS, globFiles, readSourceText } from '../rules/shared';
import {
  exportedConfigObject,
  keyName,
  literalStrings,
  parseSource,
  propertyValue,
  regexArray,
  stringArray,
  stringLiteral,
  unwrap,
} from './parse';

/**
 * Which test files one runner collects, read from its config without running it.
 *
 * The readers are strict on purpose: a value that is not written out as a
 * literal (a variable, a spread, an imported base config) makes the scope
 * `unreadable`, and the rule then says nothing about files under it rather than
 * guessing.
 */
export type RunnerScope =
  | {
      readonly kind: 'readable';
      readonly runner: string;
      /** Where the scope came from (a config file, or `options`). */
      readonly source: string;
      /** Repo-relative directory the patterns are relative to (`''` for the root). */
      readonly dir: string;
      readonly include: readonly string[];
      readonly exclude: readonly string[];
      /** Jest `testRegex`, matched against `/<path relative to dir>`. Replaces `include` when set. */
      readonly regex?: readonly RegExp[];
    }
  | { readonly kind: 'unreadable'; readonly runner: string; readonly source: string; readonly dir: string };

/** A runner the rule can detect from the tree. */
export type RunnerName = 'vitest' | 'jest' | 'bun' | 'playwright';

const SCRIPT_EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

/** Vitest's default `include`. */
export const VITEST_DEFAULT_INCLUDE: readonly string[] = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
/** Jest's default `testMatch`. */
export const JEST_DEFAULT_TEST_MATCH: readonly string[] = [
  '**/__tests__/**/*.?([mc])[jt]s?(x)',
  '**/?(*.)+(spec|test).?([mc])[jt]s?(x)',
];
/** The file names `bun test` collects. */
export const BUN_DEFAULT_INCLUDE: readonly string[] = ['**/*{.,_}{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'];
/** Playwright's default `testMatch`. */
export const PLAYWRIGHT_DEFAULT_TEST_MATCH: readonly string[] = ['**/*.@(spec|test).?(c|m)[jt]s?(x)'];

function configFiles(ctx: IMetaCtx, globs: readonly string[]): string[] {
  return globFiles((p) => ctx.glob(p), globs, DEFAULT_SKIP_DIRS);
}

/** Every object literal in the file assigned to a `test` key. */
function testObjects(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && keyName(node.name) === 'test') {
      const value = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(value)) found.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** A list option: its literal strings, the default when absent, or null when it cannot be read. */
function listOption(
  object: ts.ObjectLiteralExpression,
  key: string,
  fallback: readonly string[],
): readonly string[] | null {
  const value = propertyValue(object, key);
  if (value === undefined) return fallback;
  return value === null ? null : stringArray(value);
}

/** A list that only narrows (an exclude): its literal entries, unreadable ones dropped. */
function narrowingOption(object: ts.ObjectLiteralExpression, key: string): readonly string[] {
  const value = propertyValue(object, key);
  return value === undefined || value === null ? [] : literalStrings(value);
}

/** A directory option resolved against `base`, the base itself when absent, or null when unreadable. */
function dirOption(object: ts.ObjectLiteralExpression, key: string, base: string): string | null {
  const value = propertyValue(object, key);
  if (value === undefined) return base;
  const text = value === null ? null : stringLiteral(value);
  return text === null ? null : joinRelative(base, text);
}

function vitestScopes(ctx: IMetaCtx): RunnerScope[] {
  const scopes: RunnerScope[] = [];
  const files = configFiles(ctx, [
    `**/vitest.config.${SCRIPT_EXTENSIONS}`,
    `**/vitest.workspace.${SCRIPT_EXTENSIONS}`,
    `**/vite.config.${SCRIPT_EXTENSIONS}`,
  ]);
  for (const file of files) {
    const source = readSourceText((rel) => ctx.read(rel), file);
    if (source === null) continue;
    const configDir = dirName(file);
    const objects = testObjects(parseSource(file, source));
    const unreadable = (): void => {
      scopes.push({ kind: 'unreadable', runner: 'vitest', source: file, dir: configDir });
    };
    if (objects.length === 0) {
      // A Vite config without `test` is not a Vitest config. A Vitest config without one either
      // runs the defaults or merges `test` from another file it imports.
      if (!file.includes('vitest.config.')) continue;
      if (/\bmergeConfig\s*\(/u.test(source)) unreadable();
      else scopes.push({ kind: 'readable', runner: 'vitest', source: file, dir: configDir, include: VITEST_DEFAULT_INCLUDE, exclude: [] });
      continue;
    }
    for (const object of objects) {
      // A `test` object that lists projects runs only those projects, each its own `test` object
      // (inline) or config file (found on its own).
      const projects = propertyValue(object, 'projects') ?? propertyValue(object, 'workspace');
      if (projects !== undefined) continue;
      const root = dirOption(object, 'root', configDir);
      const dir = root === null ? null : dirOption(object, 'dir', root);
      const include = listOption(object, 'include', VITEST_DEFAULT_INCLUDE);
      const exclude = narrowingOption(object, 'exclude');
      if (dir === null || include === null) unreadable();
      else scopes.push({ kind: 'readable', runner: 'vitest', source: file, dir, include, exclude });
    }
  }
  return scopes;
}

function jestScope(file: string, configDir: string, config: ts.ObjectLiteralExpression): RunnerScope[] {
  const unreadable: RunnerScope = { kind: 'unreadable', runner: 'jest', source: file, dir: configDir };
  const projects = propertyValue(config, 'projects');
  if (projects !== undefined) {
    // Inline project objects are scopes of their own; string entries point at other configs.
    const inner = projects === null ? null : unwrap(projects);
    if (inner === null || !ts.isArrayLiteralExpression(inner)) return [unreadable];
    return inner.elements.flatMap((element) => {
      const value = ts.isExpression(element) ? unwrap(element) : null;
      return value !== null && ts.isObjectLiteralExpression(value) ? jestScope(file, configDir, value) : [];
    });
  }
  const rootDir = dirOption(config, 'rootDir', configDir);
  if (rootDir === null) return [unreadable];
  const regexValue = propertyValue(config, 'testRegex');
  const regex = regexValue === undefined ? undefined : regexValue === null ? null : regexArray(regexValue);
  const testMatch = listOption(config, 'testMatch', JEST_DEFAULT_TEST_MATCH);
  if (regex === null || testMatch === null) return [unreadable];
  const include = testMatch.map((pattern) => pattern.replace(/^<rootDir>\//u, ''));
  return [{ kind: 'readable', runner: 'jest', source: file, dir: rootDir, include, exclude: [], ...(regex ? { regex } : {}) }];
}

function jestJsonScope(file: string, configDir: string, config: Record<string, unknown>): RunnerScope {
  const unreadable: RunnerScope = { kind: 'unreadable', runner: 'jest', source: file, dir: configDir };
  if ('projects' in config) return unreadable;
  const rootDir = typeof config['rootDir'] === 'string' ? joinRelative(configDir, config['rootDir']) : configDir;
  const testMatch = config['testMatch'] ?? JEST_DEFAULT_TEST_MATCH;
  if (!Array.isArray(testMatch) || !testMatch.every((entry) => typeof entry === 'string')) return unreadable;
  const include = (testMatch as string[]).map((pattern) => pattern.replace(/^<rootDir>\//u, ''));
  const rawRegex = config['testRegex'];
  if (rawRegex === undefined) return { kind: 'readable', runner: 'jest', source: file, dir: rootDir, include, exclude: [] };
  const list = Array.isArray(rawRegex) ? rawRegex : [rawRegex];
  try {
    const regex = list.map((entry) => {
      if (typeof entry !== 'string') throw new TypeError('not a string');
      return new RegExp(entry, 'u');
    });
    return { kind: 'readable', runner: 'jest', source: file, dir: rootDir, include, exclude: [], regex };
  } catch {
    return unreadable;
  }
}

function jestScopes(ctx: IMetaCtx, manifests: readonly ManifestEntry[]): RunnerScope[] {
  const scopes: RunnerScope[] = [];
  for (const file of configFiles(ctx, [`**/jest.config.${SCRIPT_EXTENSIONS}`, '**/jest.config.json'])) {
    const source = readSourceText((rel) => ctx.read(rel), file);
    if (source === null) continue;
    const configDir = dirName(file);
    if (file.endsWith('.json')) {
      const config = parseJson(source);
      scopes.push(config === null ? { kind: 'unreadable', runner: 'jest', source: file, dir: configDir } : jestJsonScope(file, configDir, config));
      continue;
    }
    const config = exportedConfigObject(parseSource(file, source));
    scopes.push(...(config === null ? [{ kind: 'unreadable', runner: 'jest', source: file, dir: configDir } as const] : jestScope(file, configDir, config)));
  }
  for (const manifest of manifests) {
    const config = asRecord(manifest.pkg['jest']);
    if (config !== null) scopes.push(jestJsonScope(manifest.file, manifest.dir, config));
  }
  return scopes;
}

function playwrightScopes(ctx: IMetaCtx): RunnerScope[] {
  const scopes: RunnerScope[] = [];
  for (const file of configFiles(ctx, [`**/playwright.config.${SCRIPT_EXTENSIONS}`])) {
    const source = readSourceText((rel) => ctx.read(rel), file);
    if (source === null) continue;
    const configDir = dirName(file);
    const config = exportedConfigObject(parseSource(file, source));
    const dir = config === null ? null : dirOption(config, 'testDir', configDir);
    const include = config === null ? null : listOption(config, 'testMatch', PLAYWRIGHT_DEFAULT_TEST_MATCH);
    const exclude = config === null ? [] : narrowingOption(config, 'testIgnore');
    // Projects can narrow or move `testDir` / `testMatch`; reading every project is not worth the
    // guesswork, so a config with projects that set them is left alone.
    const projects = config === null ? undefined : propertyValue(config, 'projects');
    const projectsMove = projects !== undefined && (projects === null || /\b(?:testDir|testMatch|testIgnore)\b/u.test(projects.getText()));
    if (dir === null || include === null || projectsMove) {
      scopes.push({ kind: 'unreadable', runner: 'playwright', source: file, dir: configDir });
    } else {
      scopes.push({ kind: 'readable', runner: 'playwright', source: file, dir, include, exclude });
    }
  }
  return scopes;
}

interface ManifestEntry {
  readonly file: string;
  readonly dir: string;
  readonly pkg: Record<string, unknown>;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function manifests(ctx: IMetaCtx): ManifestEntry[] {
  return configFiles(ctx, ['**/package.json']).flatMap((file) => {
    const text = readSourceText((rel) => ctx.read(rel), file);
    const pkg = text === null ? null : parseJson(text);
    return pkg === null ? [] : [{ file, dir: dirName(file), pkg }];
  });
}

/** `bun test` in a package script, the arguments after it, or null when no script runs it. */
function bunTestArguments(pkg: Record<string, unknown>): string[][] {
  const scripts = asRecord(pkg['scripts']) ?? {};
  const runs: string[][] = [];
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/(?:^|[\s;&|(])bun\s+test\b([^;&|)]*)/gu)) {
      runs.push((match[1] ?? '').trim().split(/\s+/u).filter(Boolean));
    }
  }
  return runs;
}

function bunScopes(entries: readonly ManifestEntry[]): RunnerScope[] {
  const scopes: RunnerScope[] = [];
  for (const { file, dir, pkg } of entries) {
    for (const args of bunTestArguments(pkg)) {
      // A positional argument filters which files run; it is not a pattern this rule can read.
      const filtered = args.some((arg) => !arg.startsWith('-'));
      scopes.push(
        filtered
          ? { kind: 'unreadable', runner: 'bun', source: file, dir }
          : { kind: 'readable', runner: 'bun', source: file, dir, include: BUN_DEFAULT_INCLUDE, exclude: [] },
      );
    }
  }
  return scopes;
}

/** Every runner scope detected in the tree for the runners named. */
export function detectRunnerScopes(ctx: IMetaCtx, runners: readonly RunnerName[]): RunnerScope[] {
  const wanted = new Set(runners);
  const entries = wanted.has('jest') || wanted.has('bun') ? manifests(ctx) : [];
  return [
    ...(wanted.has('vitest') ? vitestScopes(ctx) : []),
    ...(wanted.has('jest') ? jestScopes(ctx, entries) : []),
    ...(wanted.has('bun') ? bunScopes(entries) : []),
    ...(wanted.has('playwright') ? playwrightScopes(ctx) : []),
  ];
}

/** `file` relative to `dir`, or null when it is not under it. */
export function relativeTo(file: string, dir: string): string | null {
  if (dir === '') return file;
  return file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : null;
}

/** Whether a readable scope collects `file`. */
export function scopeCollects(scope: Extract<RunnerScope, { kind: 'readable' }>, file: string): boolean {
  const rel = relativeTo(file, normalizeRelative(scope.dir));
  if (rel === null) return false;
  const included =
    scope.regex === undefined ? matchesAnyGlob(rel, scope.include) : scope.regex.some((regex) => regex.test(`/${rel}`));
  return included && !matchesAnyGlob(rel, scope.exclude);
}
