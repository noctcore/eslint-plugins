import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { createGithubActionsSelfHostedForkGuardRule } from '../../src/rules/github-actions-self-hosted-fork-guard';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const RULE_ID = 'github-actions-self-hosted-fork-guard';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI = '.github/workflows/ci.yml';
const GUARD = '!github.event.pull_request.head.repo.fork';

function run(text: string, options = {}) {
  return createGithubActionsSelfHostedForkGuardRule(options).run(createFakeCtx({ files: { [CI]: text } }));
}

function workflow(on: string, runsOn: string): string {
  return `name: ci\n${on}\njobs:\n  build:\n${runsOn}\n    steps: []\n`;
}

const PR = 'on: pull_request';

describe('github-actions-self-hosted-fork-guard', () => {
  test('reports a self-hosted runs-on in a pull_request workflow, with the file and the runs-on line', () => {
    const violations = run(workflow(PR, '    runs-on: self-hosted'));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(CI);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toMatch(/^line 5: /u);
  });

  test('reads the flow list, block list and labels mapping forms of runs-on', () => {
    const forms = [
      '    runs-on: [self-hosted, linux]',
      '    runs-on:\n      - self-hosted\n      - linux',
      '    runs-on:\n      group: x\n      labels: [self-hosted, linux]',
    ];

    for (const form of forms) {
      const violations = run(workflow(PR, form));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(5);
    }
  });

  test('reads every pull_request trigger form', () => {
    const triggers = [
      'on: pull_request',
      'on: [push, pull_request]',
      'on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]',
      'on:\n  - push\n  - pull_request',
      '"on": pull_request',
    ];

    for (const on of triggers) {
      expect(run(workflow(on, '    runs-on: self-hosted'))).toHaveLength(1);
    }
  });

  test('reports nothing without a pull_request trigger', () => {
    const runsOn = '    runs-on: self-hosted';
    const triggers = [
      'on: push',
      'on: pull_request_target',
      'on: [push, pull_request_target]',
      'on:\n  pull_request_target:\n    types: [opened]',
      'on:\n  push:\n    paths:\n      - pull_request',
      'on:\n  push:\n    branches: [main]\n  # pull_request:\n  workflow_dispatch:',
    ];

    for (const on of triggers) {
      expect(run(workflow(on, runsOn))).toEqual([]);
    }
    expect(run(workflow(PR, runsOn))).toHaveLength(1);
  });

  test('passes a GitHub-hosted runner and an unlisted expression', () => {
    for (const runsOn of [
      '    runs-on: ubuntu-24.04',
      '    runs-on: ${{ matrix.os }}',
      '    runs-on: my-self-hosted-pool',
    ]) {
      expect(run(workflow(PR, runsOn))).toEqual([]);
    }
  });

  test('passes a runs-on that holds the default guard, whatever its whitespace', () => {
    const guarded = [
      `    runs-on: \${{ ${GUARD} && 'self-hosted' || 'ubuntu-24.04' }}`,
      `    runs-on: \${{ ! github.event.pull_request.head.repo.fork && 'self-hosted' || 'ubuntu-24.04' }}`,
      `    runs-on: >-\n      \${{ ! github.event.pull_request.head.repo.\n      fork && 'self-hosted' || 'ubuntu-24.04' }}`,
    ];

    for (const runsOn of guarded) {
      expect(run(workflow(PR, runsOn))).toEqual([]);
    }
    expect(
      run(workflow(PR, "    runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}")),
    ).toHaveLength(1);
  });

  test('a job-level if guard does not count', () => {
    const text = `name: ci\non: pull_request\njobs:\n  build:\n    if: \${{ ${GUARD} }}\n    runs-on: self-hosted\n`;
    const violations = run(text);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
  });

  test('reports a listed selfHostedExpressions entry unless it holds the guard', () => {
    const options = { selfHostedExpressions: ['vars.CI_RUNNER'] };

    for (const runsOn of ['    runs-on: ${{ vars.CI_RUNNER }}', '    runs-on: ${{vars.CI_RUNNER}}']) {
      const violations = run(workflow(PR, runsOn), options);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message ?? '').toContain('vars.CI_RUNNER');
    }
    expect(
      run(workflow(PR, `    runs-on: \${{ ${GUARD} && vars.CI_RUNNER || 'ubuntu-24.04' }}`), options),
    ).toEqual([]);
    expect(run(workflow(PR, '    runs-on: ${{ vars.CI_RUNNER }}'))).toEqual([]);
  });

  test('a custom forkGuard replaces the default', () => {
    const custom = 'github.event.pull_request.head.repo.full_name == github.repository';
    const options = { forkGuard: custom };
    const defaultGuarded = `    runs-on: \${{ ${GUARD} && 'self-hosted' || 'ubuntu-24.04' }}`;
    const customGuarded = `    runs-on: \${{ github.event.pull_request.head.repo.full_name ==   github.repository && 'self-hosted' || 'ubuntu-24.04' }}`;

    expect(run(workflow(PR, defaultGuarded), options)).toHaveLength(1);
    expect(run(workflow(PR, customGuarded), options)).toEqual([]);
  });

  test('an empty forkGuard never counts as present and empty expression entries are skipped', () => {
    expect(
      run(workflow(PR, `    runs-on: \${{ ${GUARD} && 'self-hosted' || 'ubuntu-24.04' }}`), { forkGuard: '' }),
    ).toHaveLength(1);
    expect(run(workflow(PR, '    runs-on: ubuntu-24.04'), { selfHostedExpressions: ['', '  '] })).toEqual([]);
  });

  test('ignores a commented-out runs-on', () => {
    expect(run(workflow(PR, '    # runs-on: self-hosted\n    runs-on: ubuntu-24.04'))).toEqual([]);
    expect(run(workflow(PR, '    runs-on: ubuntu-24.04 # self-hosted later'))).toEqual([]);
  });

  test('the factory defaults to the ci category and failing CI, and ciCritical can be turned off', () => {
    const rule = createGithubActionsSelfHostedForkGuardRule();

    expect(rule.id).toBe(RULE_ID);
    expect(rule.category).toBe('ci');
    expect(rule.ciCritical).toBe(true);
    expect(createGithubActionsSelfHostedForkGuardRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  test("reports nothing on this repository's own workflows by default, and only ci.yml's matrix runner when matrix.os is listed", () => {
    const ctx = diskCtx(REPO_ROOT);
    const expectedLine = (ctx.read(CI) ?? '').split('\n').findIndex((l) => l.includes('runs-on: ${{ matrix.os }}')) + 1;

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(createGithubActionsSelfHostedForkGuardRule().run(ctx)).toEqual([]);

    const listed = createGithubActionsSelfHostedForkGuardRule({ selfHostedExpressions: ['matrix.os'] }).run(ctx);
    expect(expectedLine).toBeGreaterThan(0);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.file).toBe(CI);
    expect(listed[0]?.line).toBe(expectedLine);
  });
});
