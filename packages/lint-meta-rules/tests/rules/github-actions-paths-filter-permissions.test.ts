import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { createGithubActionsPathsFilterPermissionsRule } from '../../src/rules/github-actions-paths-filter-permissions';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const RULE_ID = 'github-actions-paths-filter-permissions';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI = '.github/workflows/ci.yml';

function run(text: string, options = {}, file = CI) {
  return createGithubActionsPathsFilterPermissionsRule(options).run(createFakeCtx({ files: { [file]: text } }));
}

function workflow(top: string, jobBlock: string, uses = 'dorny/paths-filter@v3'): string {
  return `name: ci\non: pull_request\n${top}jobs:\n  changes:\n${jobBlock}    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v6\n      - uses: ${uses}\n`;
}

describe('github-actions-paths-filter-permissions', () => {
  test('reports a job-level block that drops the workflow-level pull-requests grant, with file and line', () => {
    const violations = run(
      workflow('permissions: { contents: read, pull-requests: read }\n', '    permissions:\n      contents: read\n'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(CI);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(11);
    expect(violations[0]?.message ?? '').toMatch(/^line 11: /u);
    expect(violations[0]?.message ?? '').toContain('replaces the workflow-level block');
    expect(violations[0]?.message ?? '').toContain('job "changes"');
  });

  test('reports pull-requests: none', () => {
    const violations = run(workflow('', '    permissions:\n      pull-requests: none\n'));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('`pull-requests` is `none`');
  });

  test('reports permissions: {}', () => {
    const violations = run(workflow('', '    permissions: {}\n'));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('empty');
  });

  test('reports a mapping without pull-requests', () => {
    const violations = run(workflow('permissions:\n  contents: read\n', ''));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('does not list `pull-requests`');
  });

  test('reports a filter job when neither level declares permissions, naming the default token', () => {
    const violations = run(workflow('', ''));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('repository default token');
  });

  test('reports once per job however many filter steps it runs', () => {
    const text = `${workflow('', '')}      - uses: dorny/paths-filter@v3\n`;

    expect(run(text)).toHaveLength(1);
  });

  test('accepts a workflow-level { contents: read, pull-requests: read } with no job block', () => {
    expect(run(workflow('permissions: { contents: read, pull-requests: read }\n', ''))).toEqual([]);
  });

  test('accepts a job-level pull-requests: write', () => {
    expect(run(workflow('', '    permissions:\n      pull-requests: write\n'))).toEqual([]);
  });

  test('accepts read-all and write-all at either level', () => {
    expect(run(workflow('permissions: read-all\n', ''))).toEqual([]);
    expect(run(workflow('permissions: write-all\n', ''))).toEqual([]);
    expect(run(workflow('', '    permissions: read-all\n'))).toEqual([]);
    expect(run(workflow('', '    permissions: write-all\n'))).toEqual([]);
  });

  test('accepts a job that runs no filter action', () => {
    expect(run(workflow('permissions:\n  contents: read\n', '', 'actions/setup-node@v6'))).toEqual([]);
  });

  test('matches a SHA-pinned and a tag-pinned ref the same way', () => {
    const sha = 'dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36 # v3';

    expect(run(workflow('', '', sha))).toHaveLength(1);
    expect(run(workflow('', '', 'dorny/paths-filter@v3'))).toHaveLength(1);
    expect(run(workflow('', '', 'DORNY/Paths-Filter@v3'))).toHaveLength(1);
  });

  test('does not match a longer action name', () => {
    expect(run(workflow('', '', 'dorny/paths-filter-extra@v1'))).toEqual([]);
  });

  test('skips a wrapped flow mapping', () => {
    expect(run(workflow('', '    permissions: { contents: read,\n      pull-requests: read }\n'))).toEqual([]);
  });

  test('a custom filterActions entry is detected and the default is then not', () => {
    const options = { filterActions: ['my-org/changed-files'] };

    expect(run(workflow('', '', 'my-org/changed-files@v2'), options)).toHaveLength(1);
    expect(run(workflow('', '', 'dorny/paths-filter@v3'), options)).toEqual([]);
  });

  test('ciCritical defaults to true and can be turned off', () => {
    expect(createGithubActionsPathsFilterPermissionsRule().ciCritical).toBe(true);
    expect(createGithubActionsPathsFilterPermissionsRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  test('workflowGlobs limits the files read', () => {
    const text = workflow('', '');

    expect(run(text, { workflowGlobs: ['.github/workflows/other.yml'] })).toEqual([]);
    expect(run(text, { workflowGlobs: ['ci/*.yml'] }, 'ci/pipeline.yml')).toHaveLength(1);
  });

  test("reports nothing on this repository's own workflows", () => {
    const ctx = diskCtx(REPO_ROOT);

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(createGithubActionsPathsFilterPermissionsRule().run(ctx)).toEqual([]);
    expect(
      createGithubActionsPathsFilterPermissionsRule({ filterActions: ['actions/checkout'] }).run(ctx).length,
    ).toBeGreaterThan(0);
  });
});
