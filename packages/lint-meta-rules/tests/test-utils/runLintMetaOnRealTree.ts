import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type * as I18nRules from '../../src/i18n';
import type * as PrismaRules from '../../src/prisma';
import type * as ResolvedConfigRules from '../../src/resolved-config';
import type * as Rules from '../../src/rules';

type Factories = typeof Rules & typeof I18nRules & typeof PrismaRules & typeof ResolvedConfigRules;

/** A rule factory exported by this package (any entry point), by name. */
export type RuleFactoryName = {
  [K in keyof Factories]: K extends `create${string}Rule` ? K : never;
}[keyof Factories];

export interface RealTreeRun {
  /** The harness CLI's exit code. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every `[ERROR]` / `[info]` violation line the harness printed, as `rule (file): message`. */
  readonly violations: readonly string[];
}

export interface RealTreeRunOptions {
  /**
   * `bun` (default) imports the rule from `src/` under Bun, as consumers run the
   * harness. `node-eslint9` imports the BUILT `dist/` under Node with ESLint
   * redirected to 9.0.0, the floor of the peer range: Bun ignores the
   * `NODE_OPTIONS` hook the root `test:eslint9` script relies on.
   */
  readonly runtime?: 'bun' | 'node-eslint9';
}

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRY_HOME = path.join(PACKAGE_ROOT, 'node_modules/.cache/lint-meta-real');
const ESLINT9_HOOK = path.join(PACKAGE_ROOT, '../eslint-test-utils/eslint9.mjs');

/**
 * The harness CLI that builds the REAL `ctx`: the one consumers run. Its
 * `createNodeCtx` is not exported, so the only honest way to exercise the real
 * `ctx.glob` is to spawn the CLI itself. `LINT_META_HARNESS_CLI` points the
 * tests at another harness build, which is how they were shown to fail on 0.2.0.
 */
function harnessCli(): string {
  const override = process.env.LINT_META_HARNESS_CLI;
  if (override !== undefined && override !== '') return override;
  return path.join(path.dirname(fileURLToPath(import.meta.resolve('@noctcore/harness'))), 'cli.js');
}

/** The entry point each factory outside the main catalog is exported from. */
const SUBPATH_ENTRIES: Partial<Record<RuleFactoryName, string>> = {
  createTranslationDeadKeysRule: 'i18n',
  createEslintConfigNoWarnRule: 'resolved-config',
  createPrismaMethodSurfaceRule: 'prisma',
  createTenantModelRegistryParityRule: 'prisma',
};

function entryFor(factory: RuleFactoryName, runtime: 'bun' | 'node-eslint9'): string {
  const entry = SUBPATH_ENTRIES[factory] ?? 'index';
  return runtime === 'bun' ? path.join(PACKAGE_ROOT, `src/${entry}.ts`) : path.join(PACKAGE_ROOT, `dist/${entry}.js`);
}

/**
 * Write `files` into a real temp directory, then run one rule over it through
 * `harness lint-meta`.
 *
 * This proves REACHABILITY, which `createFakeCtx` cannot: the fake's glob
 * matches whatever the test hands it, so it passed while Bun's real glob
 * returned nothing for any dot-directory segment (`.github/workflows/...`).
 */
export function runLintMetaOnRealTree(
  files: Readonly<Record<string, string>>,
  factory: RuleFactoryName,
  options: object = {},
  runOptions: RealTreeRunOptions = {},
): RealTreeRun {
  const runtime = runOptions.runtime ?? 'bun';
  const base = mkdtempSync(path.join(tmpdir(), 'lint-meta-real-'));
  // The registry lives OUTSIDE the scanned tree, so it can never be a match
  // itself, and inside this package, so it resolves `eslint` from here.
  mkdirSync(REGISTRY_HOME, { recursive: true });
  const registryDir = mkdtempSync(path.join(REGISTRY_HOME, 'registry-'));
  try {
    const repo = path.join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(repo, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
    }

    const registry = path.join(registryDir, 'registry.mjs');
    writeFileSync(
      registry,
      [
        `import { Linter } from 'eslint';`,
        `import { ${factory} } from ${JSON.stringify(entryFor(factory, runtime))};`,
        `console.log('eslint ' + new Linter().version);`,
        `export const META_RULES = [${factory}(${JSON.stringify(options)})];`,
        '',
      ].join('\n'),
      'utf8',
    );
    const [command, prefix] =
      runtime === 'bun' ? [process.execPath, []] : ['node', ['--import', ESLINT9_HOOK]];
    // The child gets its runtime from `prefix`, not from an inherited
    // NODE_OPTIONS: the root `test:eslint9` script sets one whose bare
    // specifier does not resolve from here.
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const res = spawnSync(
      command,
      [...prefix, harnessCli(), 'lint-meta', '--dir', repo, '--registry', registry],
      { encoding: 'utf8', env },
    );
    const stderr = res.stderr ?? '';
    return {
      code: typeof res.status === 'number' ? res.status : 1,
      stdout: res.stdout ?? '',
      stderr,
      violations: stderr
        .split('\n')
        .filter((line) => /^\[(?:ERROR|info)\] /u.test(line))
        .map((line) => line.replace(/^\[(?:ERROR|info)\] /u, '')),
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(registryDir, { recursive: true, force: true });
  }
}
