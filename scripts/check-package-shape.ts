/**
 * Checks what each published package would look like on npm, from the packed
 * tarball rather than the source tree.
 *
 * Every package is a tsup dual build (ESM plus CommonJS, each with its own
 * declarations), and the manifest is what decides which file a consumer gets.
 * A manifest that pointed one `types` entry at both conditions handed CommonJS
 * TypeScript consumers ESM declarations for a `.cjs` file, and nothing in the
 * build or the tests noticed, because both only read the source.
 *
 * So for each package that is not private, this packs it with `bun pm pack` and
 * runs two independent checkers on the result:
 *
 * - publint: the manifest fields, `exports` ordering and the files they name;
 * - @arethetypeswrong/cli: which declarations each module resolution mode
 *   actually resolves, compared with the JavaScript it loads.
 *
 * Run it after `bun run build`; it exits non-zero if either checker complains
 * about any package.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGES = fileURLToPath(new URL('../packages/', import.meta.url));

interface Manifest {
  readonly name: string;
  readonly private?: boolean;
}

function run(command: string, args: readonly string[], cwd: string): boolean {
  // process.execPath is the running bun, so `bun x <bin>` resolves the pinned
  // root devDependency on macOS, Linux and Windows alike, without a shell.
  const result = spawnSync(process.execPath, ['x', command, ...args], {
    cwd,
    stdio: 'inherit',
  });
  return result.status === 0;
}

const published = readdirSync(PACKAGES)
  .sort()
  .map((dir) => ({
    dir: join(PACKAGES, dir),
    manifest: JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf8')) as Manifest,
  }))
  .filter(({ manifest }) => manifest.private !== true);

const scratch = mkdtempSync(join(tmpdir(), 'package-shape-'));
const failed: string[] = [];

try {
  for (const { dir, manifest } of published) {
    console.log(`\n=== ${manifest.name}`);
    const before = new Set(readdirSync(scratch));
    const packed = spawnSync(process.execPath, ['pm', 'pack', '--destination', scratch, '--quiet'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const tarball = readdirSync(scratch).find((file) => !before.has(file));
    if (packed.status !== 0 || tarball === undefined) {
      failed.push(`${manifest.name} (bun pm pack failed)`);
      continue;
    }

    const lintOk = run('publint', ['--strict'], dir);
    // `node16` skips the legacy `node10` resolution mode, which ignores
    // `exports` and so can never see lint-meta-rules' subpath entries. Every
    // supported consumer (Node 22, ESLint 9+ flat config) resolves through
    // `exports`, which `node16` and `bundler` both check.
    const typesOk = run(
      'attw',
      [join(scratch, tarball), '--profile', 'node16', '--format', 'table-flipped'],
      dir,
    );
    if (!lintOk) failed.push(`${manifest.name} (publint)`);
    if (!typesOk) failed.push(`${manifest.name} (attw)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failed.length > 0) {
  console.error(`\npackage shape check failed for:\n${failed.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`\npackage shape ok: ${published.length} package(s)`);
