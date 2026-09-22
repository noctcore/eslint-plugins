/**
 * Rewrites each plugin's `VERSION` constant from its own package.json.
 *
 * Every plugin exposes `meta.version` so ESLint, the config inspector and any
 * cache keyed on plugin identity can tell two builds apart. That value came
 * from a literal in `src/index.ts` while the real version came from changesets,
 * which is one fact stored twice, and the two had drifted in all nine plugins
 * at once: contracts said 0.3.0 while publishing 0.6.0, prisma said 0.1.0 while
 * publishing 0.3.1. Nothing failed, because nothing compared them.
 *
 * So this runs as part of `version-packages`, right after changesets writes the
 * new numbers, and `plugin-meta.test.ts` fails when the two disagree. The sync
 * keeps them equal without anyone remembering; the test is what notices if this
 * script stops running.
 *
 * `--check` reports drift without writing, for anywhere that wants to ask
 * rather than fix.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = fileURLToPath(new URL('../packages/', import.meta.url));
const VERSION_LINE = /^(const VERSION = ')([^']*)(';)$/mu;

interface Drift {
  readonly plugin: string;
  readonly declared: string;
  readonly found: string;
}

function pluginDirs(): string[] {
  return readdirSync(PACKAGES)
    .filter((dir) => dir.startsWith('eslint-plugin-'))
    .sort();
}

function syncOne(dir: string, write: boolean): Drift | null {
  const manifest = join(PACKAGES, dir, 'package.json');
  const entry = join(PACKAGES, dir, 'src/index.ts');
  const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
  const source = readFileSync(entry, 'utf8');

  const match = VERSION_LINE.exec(source);
  if (match === null) {
    throw new Error(
      `${dir}/src/index.ts has no \`const VERSION = '...'\` line. Either it stopped declaring one, or its shape changed and this script needs to change with it.`,
    );
  }

  const found = match[2] ?? '';
  if (found === declared) return null;

  if (write) {
    writeFileSync(entry, source.replace(VERSION_LINE, `$1${declared}$3`));
  }
  return { plugin: dir, declared, found };
}

const check = process.argv.includes('--check');
const drifted = pluginDirs().flatMap((dir) => {
  const drift = syncOne(dir, !check);
  return drift === null ? [] : [drift];
});

if (drifted.length === 0) {
  console.log(`plugin versions in sync: ${pluginDirs().length} plugin(s)`);
  process.exit(0);
}

for (const { plugin, declared, found } of drifted) {
  console.log(
    check
      ? `${plugin}: meta.version says ${found} but package.json says ${declared}`
      : `${plugin}: ${found} -> ${declared}`,
  );
}

if (check) {
  console.log(`\n${drifted.length} plugin(s) out of sync. Run \`bun run sync:versions\`.`);
  process.exit(1);
}
console.log(`\nsynced ${drifted.length} plugin(s)`);
