import { describe, expect, test } from 'bun:test';

import { createGithubActionsShaPinnedRule } from '../../src/rules/github-actions-sha-pinned';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createGithubActionsShaPinnedRule();

const SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803';

function violationsFor(steps: string) {
  const ctx = createFakeCtx({
    files: {
      '.github/workflows/ci.yml': `jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n${steps}`,
    },
  });
  return rule.run(ctx);
}

describe('github-actions-sha-pinned', () => {
  test('reports a tag-pinned action, naming the ref and the line', () => {
    const violations = violationsFor('      - uses: actions/checkout@v6\n');

    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('github-actions-sha-pinned');
    expect(violations[0]?.message ?? '').toMatch(
      /line 5: `uses: actions\/checkout@v6` is not pinned/u,
    );
  });

  test('reports a branch ref, an unversioned ref and a short SHA', () => {
    const violations = violationsFor(
      [
        '      - uses: actions/checkout@main',
        '      - uses: actions/checkout',
        '      - uses: actions/checkout@d23441a',
        '',
      ].join('\n'),
    );

    expect(violations.length).toBe(3);
  });

  test('passes a full SHA with a version comment', () => {
    expect(violationsFor(`      - uses: actions/checkout@${SHA} # v6\n`)).toEqual([]);
  });

  test('reports a SHA-pinned action that has no version comment', () => {
    const violations = violationsFor(`      - uses: actions/checkout@${SHA}\n`);

    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/no `# vN` comment/u);
  });

  test('accepts a quoted ref and a path inside the action repo', () => {
    expect(
      violationsFor(
        `      - uses: 'github/codeql-action/analyze@${SHA}' # v3\n        with:\n          x: 1\n`,
      ),
    ).toEqual([]);
  });

  test('exempts a local action and requires a digest on a docker:// ref', () => {
    expect(violationsFor('      - uses: ./.github/actions/setup\n')).toEqual([]);

    const violations = violationsFor('      - uses: docker://alpine:3.20\n');
    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/not pinned by digest/u);
    expect(violationsFor(`      - uses: docker://alpine:3.20@sha256:${'a'.repeat(64)}\n`)).toEqual(
      [],
    );
  });

  test('checks a job-level reusable workflow call too', () => {
    const ctx = createFakeCtx({
      files: {
        '.github/workflows/ci.yml':
          'jobs:\n  call:\n    uses: org/repo/.github/workflows/x.yml@v1\n',
      },
    });

    expect(rule.run(ctx).length).toBe(1);
  });

  test('honors custom workflowGlobs and reports a line number', () => {
    const custom = createGithubActionsShaPinnedRule({ workflowGlobs: ['ci/*.yml'] });
    const ctx = createFakeCtx({
      files: {
        '.github/workflows/ci.yml': '      - uses: actions/checkout@v6\n',
        'ci/build.yml': 'steps:\n  - uses: actions/checkout@v6\n',
      },
    });
    const v = custom.run(ctx);
    expect(v.map((x) => x.file)).toEqual(['ci/build.yml']);
    expect(v[0]?.line).toBe(2);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsShaPinnedRule().ciCritical).toBe(true);
    expect(createGithubActionsShaPinnedRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
