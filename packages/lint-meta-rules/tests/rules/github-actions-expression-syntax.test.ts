import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  checkWorkflowExpressionSyntax,
  createGithubActionsExpressionSyntaxRule,
} from '../../src/rules/github-actions-expression-syntax';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const rule = createGithubActionsExpressionSyntaxRule();
const RULE_ID = 'github-actions-expression-syntax';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const HEAD = 'name: ci\non: push\njobs:\n  build:\n';

function violationsFor(body: string) {
  return rule.run(createFakeCtx({ files: { '.github/workflows/ci.yml': `${HEAD}${body}` } }));
}

describe('github-actions-expression-syntax', () => {
  test('reports a ${{ immediately followed by another { (the f-string trap), with the file and line', () => {
    const violations = violationsFor(
      `    runs-on: ubuntu-24.04\n    steps:\n      - run: python -c "print(f'\${{{name}}}')"\n`,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('.github/workflows/ci.yml');
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(7);
    expect(violations[0]?.message ?? '').toMatch(/^line 7: .*\$\{\{\{/u);
  });

  test('reports a ${{ with no closing }} on its line', () => {
    const violations = violationsFor(
      `    if: \${{ github.ref == 'refs/heads/main'\n    runs-on: ubuntu-24.04\n`,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toContain('}}');
  });

  test('accepts a closed expression', () => {
    expect(violationsFor(`    if: \${{ github.event_name == 'push' }}\n`)).toEqual([]);
  });

  test('treats a quoted }} or ${{ inside an expression as string text', () => {
    expect(violationsFor(`    if: \${{ '\${{' }}\n`)).toEqual([]);
    expect(violationsFor(`    if: \${{ 'a}}b'\n`)).toHaveLength(1);
    expect(violationsFor(`    if: \${{ 'it''s }}' == x }}\n`)).toEqual([]);
  });

  test('reports a second opener before the first closes', () => {
    const violations = violationsFor('      - run: echo ${{ a ${{ b }}\n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
  });

  test('accepts an expression that spans lines inside a folded block scalar', () => {
    const body = [
      '    if: >-',
      "      ${{ github.event_name == 'push' &&",
      "      github.ref == 'refs/heads/main' }}",
      '    runs-on: ubuntu-24.04',
      '',
    ].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test('accepts an expression that spans lines inside a literal block and a multi-line plain scalar', () => {
    const body = [
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: |',
      '          echo "${{ github.ref',
      '            }}"',
      '        if: ${{ a &&',
      '          b }}',
      '',
    ].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test('reports an unclosed opener inside a block scalar, at the opener line', () => {
    const body = [
      '    if: >-',
      "      ${{ github.event_name == 'push' &&",
      "      github.ref == 'refs/heads/main'",
      '    name: "}}"',
      '',
    ].join('\n');
    const violations = violationsFor(body);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
  });

  test('checks a ${{ in a YAML comment like any other text', () => {
    expect(violationsFor('    # ${{ github.ref\n')).toHaveLength(1);
    expect(violationsFor('      - run: echo hi # ${{ x\n')).toHaveLength(1);
    expect(violationsFor('    # ${{ github.ref }}\n')).toEqual([]);
  });

  test('reports each malformed opener once, on its own line', () => {
    const lines = checkWorkflowExpressionSyntax(
      'w.yml',
      'a: ${{{x}}}\nb: ${{ ok }}\nc: ${{ open\nd: 1\n',
    ).map((violation) => violation.line);

    expect(lines).toEqual([1, 3]);
  });

  test('honors workflowGlobs', () => {
    const custom = createGithubActionsExpressionSyntaxRule({ workflowGlobs: ['ci/*.yml'] });
    const ctx = createFakeCtx({
      files: {
        '.github/workflows/ci.yml': 'if: ${{ open\n',
        'ci/build.yml': 'steps:\n  - run: ${{{x}}}\n',
      },
    });
    const found = custom.run(ctx);

    expect(found.map((violation) => violation.file)).toEqual(['ci/build.yml']);
    expect(found[0]?.line).toBe(2);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsExpressionSyntaxRule().ciCritical).toBe(true);
    expect(createGithubActionsExpressionSyntaxRule({ ciCritical: false }).ciCritical).toBe(false);
  });

  test("reports nothing on this repository's own workflows", () => {
    const ctx = diskCtx(REPO_ROOT);

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(rule.run(ctx)).toEqual([]);
  });
});
