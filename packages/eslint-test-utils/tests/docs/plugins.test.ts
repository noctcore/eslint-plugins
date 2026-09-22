/**
 * Runs every plugin's rule docs as tests. Each plugin is imported from source,
 * so a doc is checked against the rule as it is now, not as last built.
 *
 * A plugin whose docs are not yet on the executable convention is `pending`:
 * it still has to document every rule and nothing else, and it shows up as a
 * todo in every run until its examples execute.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import architecture from '../../../eslint-plugin-architecture/src/index';
import asyncSafety from '../../../eslint-plugin-async-safety/src/index';
import codeQuality from '../../../eslint-plugin-code-quality/src/index';
import contracts from '../../../eslint-plugin-contracts/src/index';
import monorepo from '../../../eslint-plugin-monorepo/src/index';
import observability from '../../../eslint-plugin-observability/src/index';
import prisma from '../../../eslint-plugin-prisma/src/index';
import react from '../../../eslint-plugin-react/src/index';
import security from '../../../eslint-plugin-security/src/index';
import { compareRulesToDocs, type DocPlugin, runPluginDocs } from '../../src';

type DocStatus = 'executed' | 'pending';

const PLUGINS: Record<string, { readonly plugin: DocPlugin; readonly status: DocStatus }> = {
  architecture: { plugin: architecture, status: 'pending' },
  'async-safety': { plugin: asyncSafety, status: 'executed' },
  'code-quality': { plugin: codeQuality, status: 'executed' },
  contracts: { plugin: contracts, status: 'executed' },
  monorepo: { plugin: monorepo, status: 'executed' },
  observability: { plugin: observability, status: 'pending' },
  prisma: { plugin: prisma, status: 'pending' },
  react: { plugin: react, status: 'pending' },
  security: { plugin: security, status: 'pending' },
};

const packagesDir = fileURLToPath(new URL('../../../', import.meta.url));
const docsDir = (name: string): string => `${packagesDir}eslint-plugin-${name}/docs/rules`;

it('lists every eslint-plugin package', () => {
  const packages = readdirSync(packagesDir)
    .filter((dir) => dir.startsWith('eslint-plugin-'))
    .map((dir) => dir.slice('eslint-plugin-'.length))
    .sort();
  expect(Object.keys(PLUGINS).sort()).toEqual(packages);
});

for (const [name, { plugin, status }] of Object.entries(PLUGINS)) {
  describe(`eslint-plugin-${name} docs`, () => {
    if (status === 'executed') {
      runPluginDocs({ plugin, docsDir: docsDir(name) });
      return;
    }
    it('documents every rule, and every doc names a rule', () => {
      expect(compareRulesToDocs(plugin, docsDir(name))).toEqual({ undocumented: [], orphaned: [] });
    });
    it.todo('executes its doc examples');
  });
}
