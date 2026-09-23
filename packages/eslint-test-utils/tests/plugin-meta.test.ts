/**
 * Every plugin's `meta.version` must be its package's real version.
 *
 * ESLint reads `meta.version` to identify a plugin, so a stale one misreports
 * which build is loaded. All nine plugins had drifted at once, by as much as
 * three minors, because the number lived in a literal in `src/index.ts` and in
 * package.json, and changesets only ever updated the second.
 *
 * `scripts/sync-plugin-versions.ts` keeps them equal. This test is what notices
 * if that script stops running, which is the failure the drift itself could not
 * announce.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import architecture from '../../eslint-plugin-architecture/src/index';
import asyncSafety from '../../eslint-plugin-async-safety/src/index';
import codeQuality from '../../eslint-plugin-code-quality/src/index';
import contracts from '../../eslint-plugin-contracts/src/index';
import monorepo from '../../eslint-plugin-monorepo/src/index';
import observability from '../../eslint-plugin-observability/src/index';
import prisma from '../../eslint-plugin-prisma/src/index';
import react from '../../eslint-plugin-react/src/index';
import rsc from '../../eslint-plugin-rsc/src/index';
import security from '../../eslint-plugin-security/src/index';

interface MetaPlugin {
  readonly meta?: { readonly name?: string; readonly version?: string };
}

const PLUGINS: Record<string, MetaPlugin> = {
  architecture,
  'async-safety': asyncSafety,
  'code-quality': codeQuality,
  contracts,
  monorepo,
  observability,
  prisma,
  react,
  rsc,
  security,
};

const packagesDir = fileURLToPath(new URL('../../', import.meta.url));

function manifest(name: string): { name: string; version: string } {
  return JSON.parse(
    readFileSync(`${packagesDir}eslint-plugin-${name}/package.json`, 'utf8'),
  ) as { name: string; version: string };
}

it('covers every eslint-plugin package', () => {
  const packages = readdirSync(packagesDir)
    .filter((dir) => dir.startsWith('eslint-plugin-'))
    .map((dir) => dir.slice('eslint-plugin-'.length))
    .sort();
  expect(Object.keys(PLUGINS).sort()).toEqual(packages);
});

describe.each(Object.entries(PLUGINS))('@noctcore/eslint-plugin-%s', (name, plugin) => {
  it('reports its real version and name in meta', () => {
    const pkg = manifest(name);
    expect(plugin.meta?.version).toBe(pkg.version);
    expect(plugin.meta?.name).toBe(pkg.name);
  });
});
