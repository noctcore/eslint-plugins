import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { createGithubActionsConcurrencyExplicitRule } from '../../src/rules/github-actions-concurrency-explicit';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const RULE_ID = 'github-actions-concurrency-explicit';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI = '.github/workflows/ci.yml';

function run(text: string, options = {}) {
  return createGithubActionsConcurrencyExplicitRule(options).run(createFakeCtx({ files: { [CI]: text } }));
}

function job(concurrency: string): string {
  return `name: ci\non: push\njobs:\n  build:\n    runs-on: x\n${concurrency}\n`;
}

describe('github-actions-concurrency-explicit', () => {
  test('reports a workflow-level block mapping without cancel-in-progress, with the file and line', () => {
    const violations = run('name: ci\non: push\nconcurrency:\n  group: ci\njobs:\n  build:\n    runs-on: x\n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(CI);
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.message ?? '').toMatch(/^line 3: /u);
    expect(violations[0]?.message ?? '').toContain('cancel-in-progress');
  });

  test('reports a job-level block mapping, naming the job', () => {
    const violations = run(job('    concurrency:\n      group: build'));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
    expect(violations[0]?.message ?? '').toContain('job "build"');
  });

  test('accepts cancel-in-progress with any value', () => {
    for (const value of ['true', 'false', "'false'", "${{ github.event_name == 'pull_request' }}"]) {
      const top = `name: ci\non: push\nconcurrency:\n  group: ci\n  cancel-in-progress: ${value}\njobs:\n  build:\n    runs-on: x\n`;
      const nested = job(`    concurrency:\n      group: build\n      cancel-in-progress: ${value}`);

      expect(run(top)).toEqual([]);
      expect(run(nested)).toEqual([]);
    }
  });

  test('reports a flow mapping without cancel-in-progress and accepts one with it', () => {
    const top = 'name: ci\non: push\nconcurrency: { group: x }\njobs:\n  build:\n    runs-on: x\n';
    const nested = job('    concurrency: { group: x }');
    const topViolations = run(top);
    const jobViolations = run(nested);

    expect(topViolations).toHaveLength(1);
    expect(topViolations[0]?.line).toBe(3);
    expect(jobViolations).toHaveLength(1);
    expect(jobViolations[0]?.line).toBe(6);
    expect(run('name: ci\non: push\nconcurrency: { group: x, cancel-in-progress: false }\n')).toEqual([]);
    expect(run(job('    concurrency: { group: x, cancel-in-progress: false }'))).toEqual([]);
  });

  test("ignores a concurrency key deeper than a job's own keys", () => {
    const withKey = job('    steps:\n      - uses: a/b@v1\n        with:\n          concurrency:\n            group: x');
    const envKey = job('    env:\n      concurrency:\n        group: x');
    const script = job('    steps:\n      - run: |\n          concurrency:\n            group: x');

    expect(run(withKey)).toEqual([]);
    expect(run(envKey)).toEqual([]);
    expect(run(script)).toEqual([]);
  });

  test('skips a flow mapping that wraps over lines', () => {
    expect(run('name: ci\non: push\nconcurrency: {\n  group: x,\n  cancel-in-progress: true }\n')).toEqual([]);
  });

  test('the string form passes by default and is reported at both levels with requireMappingForm', () => {
    const text =
      'name: ci\non: push\nconcurrency: ${{ github.workflow }}-${{ github.ref }}\njobs:\n  build:\n    runs-on: x\n    concurrency: build-${{ github.ref }}\n';
    const violations = run(text, { requireMappingForm: true });

    expect(run(text)).toEqual([]);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([3, 7]);
    for (const violation of violations) expect(violation.message).toContain('string form');
  });

  test("reports nothing on this repository's own workflows by default, and only release.yml under requireMappingForm", () => {
    const ctx = diskCtx(REPO_ROOT);
    const release = '.github/workflows/release.yml';
    const expectedLine = (ctx.read(release) ?? '').split('\n').findIndex((l) => /^concurrency:/u.test(l)) + 1;

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(createGithubActionsConcurrencyExplicitRule().run(ctx)).toEqual([]);

    const strict = createGithubActionsConcurrencyExplicitRule({ requireMappingForm: true }).run(ctx);
    expect(strict).toHaveLength(1);
    expect(strict[0]?.file).toBe(release);
    expect(strict[0]?.line).toBe(expectedLine);
    expect(expectedLine).toBeGreaterThan(0);
  });

  test('options default and override', () => {
    const rule = createGithubActionsConcurrencyExplicitRule();
    const text = 'name: ci\non: push\nconcurrency:\n  group: ci\n';

    expect(rule.ciCritical).toBe(true);
    expect(createGithubActionsConcurrencyExplicitRule({ ciCritical: false }).ciCritical).toBe(false);
    expect(rule.category).toBe('ci');
    expect(rule.id).toBe(RULE_ID);

    const custom = createGithubActionsConcurrencyExplicitRule({ workflowGlobs: ['ci/*.yml'] });
    expect(custom.run(createFakeCtx({ files: { 'ci/a.yml': text } }))).toHaveLength(1);
    expect(custom.run(createFakeCtx({ files: { [CI]: text } }))).toEqual([]);
  });
});
