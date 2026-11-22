import { describe, expect, test } from 'bun:test';

import { createGithubActionsPackageCacheRule, installsIn } from '../../src/rules/github-actions-package-cache';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const RULE_ID = 'github-actions-package-cache';
const CI = '.github/workflows/ci.yml';
const SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0';

function run(text: string, options = {}, extra: Record<string, string> = {}) {
  return createGithubActionsPackageCacheRule(options).run(createFakeCtx({ files: { [CI]: text, ...extra } }));
}

/** A one-job workflow; `steps` is the indented step list. */
function workflow(steps: string): string {
  return `name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v6\n${steps}`;
}

function setupNode(withLines = '          node-version: 22\n'): string {
  return `      - uses: ${SETUP_NODE}\n        with:\n${withLines}`;
}

describe('github-actions-package-cache', () => {
  test('reports a setup-node step with no cache in a job that installs with pnpm, at the setup step', () => {
    const violations = run(workflow(`${setupNode()}      - run: pnpm install --frozen-lockfile\n`));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(CI);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(8);
    expect(violations[0]?.message ?? '').toMatch(/^line 8: /u);
    expect(violations[0]?.message ?? '').toContain('job "build" installs with pnpm (line 11)');
    expect(violations[0]?.message ?? '').toContain('`cache: pnpm`');
  });

  test('accepts the same step with cache: pnpm', () => {
    expect(run(workflow(`${setupNode('          node-version: 22\n          cache: pnpm\n')}      - run: pnpm install\n`))).toEqual([]);
  });

  test('reports a cache that names another manager', () => {
    const violations = run(workflow(`${setupNode("          cache: 'npm'\n")}      - run: yarn install --immutable\n`));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('caches `npm`');
    expect(violations[0]?.message ?? '').toContain('Set `cache: yarn`');
  });

  test('reports an empty cache input', () => {
    expect(run(workflow(`${setupNode("          cache: ''\n")}      - run: npm ci\n`))).toHaveLength(1);
  });

  test('accepts a cache input written as an expression', () => {
    expect(run(workflow(`${setupNode('          cache: ${{ matrix.pm }}\n')}      - run: pnpm install\n`))).toEqual([]);
  });

  test('reports a job that runs bun install with no cache step, at the install step', () => {
    const steps = '      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n';
    const violations = run(workflow(steps));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(9);
    expect(violations[0]?.message ?? '').toContain('`bun install`');
    expect(violations[0]?.message ?? '').toContain('caches only the bun binary');
  });

  test('accepts a bun job with an actions/cache or actions/cache/restore step', () => {
    const cache = '      - uses: actions/cache@v4\n        with:\n          path: ~/.bun/install/cache\n          key: bun-${{ hashFiles(\'bun.lock\') }}\n';
    const restore = '      - uses: actions/cache/restore@v4\n        with:\n          path: ~/.bun/install/cache\n          key: bun\n';

    expect(run(workflow(`${cache}      - run: bun install\n`))).toEqual([]);
    expect(run(workflow(`${restore}      - run: bun install\n`))).toEqual([]);
  });

  test('an actions/cache step also satisfies npm, pnpm and yarn jobs', () => {
    const cache = '      - uses: actions/cache@v4\n        with:\n          path: ~/.pnpm-store\n          key: pnpm\n';

    expect(run(workflow(`${setupNode()}${cache}      - run: pnpm install\n`))).toEqual([]);
  });

  test('accepts npm with no cache input when the root packageManager is npm and automatic caching is on', () => {
    const manifest = { 'package.json': JSON.stringify({ packageManager: 'npm@10.9.0' }) };
    const devEngines = { 'package.json': JSON.stringify({ devEngines: { packageManager: { name: 'npm' } } }) };
    const text = workflow(`${setupNode()}      - run: npm ci\n`);

    expect(run(text, {}, manifest)).toEqual([]);
    expect(run(text, {}, devEngines)).toEqual([]);
    expect(run(text)).toHaveLength(1);
  });

  test('reports npm when package-manager-cache is false, whatever packageManager says', () => {
    const manifest = { 'package.json': JSON.stringify({ packageManager: 'npm@10.9.0' }) };
    const text = workflow(`${setupNode('          package-manager-cache: false\n')}      - run: npm ci\n`);

    expect(run(text, {}, manifest)).toHaveLength(1);
  });

  test('does not report a job that installs with npm, pnpm or yarn but has no setup-node step', () => {
    expect(run(workflow('      - run: pnpm install\n'))).toEqual([]);
  });

  test('does not report a setup-node step in a job that installs nothing, or installs with bun only', () => {
    expect(run(workflow(`${setupNode()}      - run: node scripts/check.js\n`))).toEqual([]);
    const bunJob = `${setupNode()}      - uses: actions/cache@v4\n        with:\n          path: x\n          key: y\n      - run: bun install\n`;
    expect(run(workflow(bunJob))).toEqual([]);
  });

  test('does not count commands that fetch no project tree', () => {
    const runs = [
      'npm install -g corepack',
      'npm i --global npm@11',
      'bun install --lockfile-only',
      'yarn --version',
      'pnpm run build',
      'npm run install-deps',
      'yarn build',
      'echo "npm ci"',
      '# npm ci',
    ];
    for (const command of runs) {
      expect(run(workflow(`${setupNode()}      - run: ${command}\n`))).toEqual([]);
    }
  });

  test('sees installs in a multi-line run block and after a shell operator', () => {
    expect(installsIn(['corepack enable', 'pnpm i'])).toEqual(['pnpm']);
    expect(installsIn(['cd app && npm ci'])).toEqual(['npm']);
    expect(installsIn(['yarn'])).toEqual(['yarn']);
    expect(installsIn(['yarn --frozen-lockfile'])).toEqual(['yarn']);
    expect(installsIn(['bun i'])).toEqual(['bun']);

    const block = `${setupNode()}      - run: |\n          corepack enable\n          pnpm install\n`;
    expect(run(workflow(block))).toHaveLength(1);
  });

  test('checks each job on its own', () => {
    const text = [
      'name: ci',
      'on: push',
      'jobs:',
      '  cached:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      `      - uses: ${SETUP_NODE}`,
      '        with:',
      '          cache: pnpm',
      '      - run: pnpm install',
      '  uncached:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      `      - uses: ${SETUP_NODE}`,
      '      - run: pnpm install',
      '',
    ].join('\n');
    const violations = run(text);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(14);
    expect(violations[0]?.message ?? '').toContain('job "uncached"');
  });

  test('reports a job that installs with two managers once per manager', () => {
    const violations = run(workflow(`${setupNode()}      - run: pnpm install\n      - run: bun install\n`));

    expect(violations.map((violation) => violation.line)).toEqual([8, 12]);
  });

  test('managers limits which installs are checked', () => {
    const text = workflow(`${setupNode()}      - run: pnpm install\n      - run: bun install\n`);

    expect(run(text, { managers: ['bun'] })).toHaveLength(1);
    expect(run(text, { managers: ['npm'] })).toEqual([]);
  });

  test('custom setupActions and cacheActions replace the defaults', () => {
    const custom = '      - uses: my-org/setup-js@v1\n      - run: pnpm install\n';

    expect(run(workflow(custom), { setupActions: ['my-org/setup-js'] })).toHaveLength(1);
    expect(run(workflow(custom))).toEqual([]);

    const ownCache = `${setupNode()}      - uses: my-org/restore@v1\n      - run: pnpm install\n`;
    expect(run(workflow(ownCache), { cacheActions: ['my-org/restore'] })).toEqual([]);
  });

  test('ciCritical defaults to true and can be turned off', () => {
    expect(createGithubActionsPackageCacheRule().ciCritical).toBe(true);
    expect(createGithubActionsPackageCacheRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  test('workflowGlobs limits the files read', () => {
    const text = workflow('      - run: bun install\n');

    expect(run(text, { workflowGlobs: ['.github/workflows/other.yml'] })).toEqual([]);
  });
});
