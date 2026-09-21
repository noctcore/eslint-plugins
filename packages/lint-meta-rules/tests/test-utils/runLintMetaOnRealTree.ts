import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type * as Rules from '../../src/rules';

/** A rule factory exported by this package, by name. */
export type RuleFactoryName = {
  [K in keyof typeof Rules]: K extends `create${string}Rule` ? K : never;
}[keyof typeof Rules];

export interface RealTreeRun {
  /** The harness CLI's exit code. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every `[ERROR]` / `[info]` violation line the harness printed, as `rule (file): message`. */
  readonly violations: readonly string[];
}

const SOURCE_INDEX = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

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

/**
 * Write `files` into a real temp directory, then run one rule over it through
 * `harness lint-meta` under the current runtime (Bun, as consumers run it).
 *
 * This proves REACHABILITY, which `createFakeCtx` cannot: the fake's glob
 * matches whatever the test hands it, so it passed while Bun's real glob
 * returned nothing for any dot-directory segment (`.github/workflows/...`).
 */
export function runLintMetaOnRealTree(
  files: Readonly<Record<string, string>>,
  factory: RuleFactoryName,
  options: object = {},
): RealTreeRun {
  const base = mkdtempSync(path.join(tmpdir(), 'lint-meta-real-'));
  try {
    const repo = path.join(base, 'repo');
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(repo, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
    }
    mkdirSync(repo, { recursive: true });

    // The registry lives OUTSIDE the scanned tree so it can never be a match itself.
    const registry = path.join(base, 'registry.mjs');
    writeFileSync(
      registry,
      [
        `import { ${factory} } from ${JSON.stringify(SOURCE_INDEX)};`,
        `export const META_RULES = [${factory}(${JSON.stringify(options)})];`,
        '',
      ].join('\n'),
      'utf8',
    );

    const res = spawnSync(
      process.execPath,
      [harnessCli(), 'lint-meta', '--dir', repo, '--registry', registry],
      { encoding: 'utf8' },
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
  }
}
