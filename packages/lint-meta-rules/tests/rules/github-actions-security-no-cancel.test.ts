import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  checkWorkflowSecurityNoCancel,
  createGithubActionsSecurityNoCancelRule,
} from '../../src/rules/github-actions-security-no-cancel';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const RULE_ID = 'github-actions-security-no-cancel';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SAST = '.github/workflows/ci-security-sast.yml';

function workflow(cancel: string): string {
  return `name: sast\non: push\nconcurrency:\n  group: sast-\${{ github.ref }}\n  cancel-in-progress: ${cancel}\njobs:\n  scan:\n    runs-on: ubuntu-24.04\n`;
}

function run(files: Record<string, string>, options = {}) {
  return createGithubActionsSecurityNoCancelRule(options).run(createFakeCtx({ files }));
}

describe('github-actions-security-no-cancel', () => {
  test('reports cancel-in-progress true in a top-level concurrency block, with the file and line', () => {
    const violations = run({ [SAST]: workflow('true') });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(SAST);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toMatch(/^line 5: /u);
  });

  test('passes the same workflow with cancel-in-progress false', () => {
    expect(run({ [SAST]: workflow('false') })).toEqual([]);
  });

  test('reports a job-level concurrency block', () => {
    const text =
      'name: s\non: push\njobs:\n  scan:\n    runs-on: ubuntu-24.04\n    concurrency:\n      group: scan\n      cancel-in-progress: true\n';
    const violations = run({ '.github/workflows/security.yml': text });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(8);
    expect(violations[0]?.message ?? '').toContain('job "scan"');
  });

  test('reports a flow mapping at workflow and job level', () => {
    const top = 'name: s\non: push\nconcurrency: { group: scan, cancel-in-progress: true }\njobs:\n  scan:\n    runs-on: x\n';
    const job =
      'name: s\non: push\njobs:\n  scan:\n    runs-on: x\n    concurrency: { group: scan, cancel-in-progress: true }\n';
    const topViolations = run({ '.github/workflows/security.yml': top });
    const jobViolations = run({ '.github/workflows/security.yml': job });

    expect(topViolations).toHaveLength(1);
    expect(topViolations[0]?.line).toBe(3);
    expect(jobViolations).toHaveLength(1);
    expect(jobViolations[0]?.line).toBe(6);
  });

  test('reports a quoted true', () => {
    expect(run({ [SAST]: workflow("'true'") })).toHaveLength(1);
    expect(run({ [SAST]: workflow('"true"') })).toHaveLength(1);
    expect(run({ [SAST]: workflow('True') })).toHaveLength(1);
  });

  test('leaves an expression, the string form, a run script and a commented-out line alone', () => {
    const expression = workflow("${{ github.event_name == 'pull_request' }}");
    const stringForm =
      'name: s\non: push\nconcurrency: ${{ github.workflow }}-${{ github.ref }}\njobs:\n  scan:\n    runs-on: x\n';
    const script =
      'name: s\non: push\njobs:\n  scan:\n    runs-on: x\n    steps:\n      - run: |\n          concurrency:\n            cancel-in-progress: true\n';
    const commented = 'name: s\non: push\nconcurrency:\n  group: scan\n  # cancel-in-progress: true\n';

    expect(run({ [SAST]: expression })).toEqual([]);
    expect(run({ [SAST]: stringForm })).toEqual([]);
    expect(run({ [SAST]: script })).toEqual([]);
    expect(run({ [SAST]: commented })).toEqual([]);
  });

  test('checks only security-named workflows, by base name', () => {
    const body = workflow('true');

    expect(run({ '.github/workflows/ci.yml': body, '.github/workflows/build.yml': body })).toEqual([]);
    expect(run({ '.github/workflows/CodeQL.yml': body })).toHaveLength(1);
    expect(run({ '.github/workflows/secrets-scan.yaml': body })).toHaveLength(1);
    expect(run({ 'security/ci.yml': body }, { workflowGlobs: ['security/*.yml'] })).toEqual([]);
  });

  test('a custom securityWorkflowPattern replaces the default', () => {
    const body = workflow('true');
    const files = { '.github/workflows/deploy.yml': body, '.github/workflows/security.yml': body };

    const custom = run(files, { securityWorkflowPattern: /^deploy/u });
    expect(custom.map((v) => v.file)).toEqual(['.github/workflows/deploy.yml']);

    const global = run(
      { '.github/workflows/scan-a.yml': body, '.github/workflows/scan-b.yml': body },
      { securityWorkflowPattern: /scan/giu },
    );
    expect(global).toHaveLength(2);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsSecurityNoCancelRule().ciCritical).toBe(true);
    expect(createGithubActionsSecurityNoCancelRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  test('the pure check reads a file without a jobs key', () => {
    expect(checkWorkflowSecurityNoCancel(SAST, 'name: s\nconcurrency:\n  cancel-in-progress: true\n')).toHaveLength(1);
    expect(checkWorkflowSecurityNoCancel(SAST, '')).toEqual([]);
  });

  test("reports nothing on this repository's own workflows", () => {
    const ctx = diskCtx(REPO_ROOT);

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(createGithubActionsSecurityNoCancelRule().run(ctx)).toEqual([]);
    expect(createGithubActionsSecurityNoCancelRule({ securityWorkflowPattern: /./u }).run(ctx)).toEqual([]);
  });
});
