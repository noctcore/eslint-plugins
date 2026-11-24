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

  test('accepts an expression that starts on the line after its key', () => {
    const body = ['    runs-on: ubuntu-24.04', '    if:', '      ${{ a &&', '      b }}', ''].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test('still reports an unclosed opener on the line after its key', () => {
    const body = ['    runs-on: ubuntu-24.04', '    if:', '      ${{ a &&', '      b', ''].join('\n');
    const violations = violationsFor(body);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(7);
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

  test('reports a string inside an expression that is never closed', () => {
    const violations = checkWorkflowExpressionSyntax('w.yml', "A: ${{ 'abc }}\n");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toMatch(/^line 1: a string inside `\$\{\{` is never closed/u);
  });

  test.each([
    ['A: ${{ }}', '`${{ }}` is empty'],
    ["A: ${{ contains(github.ref, 'x' }}", 'has unbalanced brackets: `(` is never closed'],
    ['A: ${{ (a && b)) }}', 'has unbalanced brackets: `)` closes nothing'],
    ['A: ${{ fromJSON(a)[0) }}', 'has unbalanced brackets: `)` closes a `[`'],
    ['A: ${{ a && }}', 'has `&&` with no right operand'],
    ['A: ${{ && a }}', 'has `&&` with no left operand'],
    ['A: ${{ a b }}', 'needs an operator between `a` and `b`'],
    ['A: ${{ a = b }}', 'uses `=`, which is not an operator (did you mean `==`?)'],
    ['A: ${{ a & b }}', 'uses `&`, which is not an operator (did you mean `&&`?)'],
    ['A: ${{ a | b }}', 'uses `|`, which is not an operator (did you mean `||`?)'],
    ['A: ${{ f(a,) }}', 'has an empty argument after `,`'],
    ['A: ${{ a, b }}', 'uses `,` outside the arguments of a function call'],
    ['A: ${{ a. }}', 'has `.` with no property name after it'],
    ['A: ${{ !a ! }}', 'needs an operator between `a` and `!`'],
    ['A: ${{ () }}', 'has an empty `()`'],
  ])('reports the malformed expression %s', (line, problem) => {
    const violations = checkWorkflowExpressionSyntax('w.yml', `${line}\n`);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.message ?? '').toContain(problem);
    expect(violations[0]?.message ?? '').toContain('GitHub rejects the whole workflow');
  });

  test('reports a grammar problem in an expression that spans a block scalar, at the opener line', () => {
    const body = ['    if: >-', '      ${{ github.event_name == &&', "      github.ref == 'x' }}", ''].join('\n');
    const violations = violationsFor(body);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
    expect(violations[0]?.message ?? '').toContain('has `==` with no right operand');
  });

  test.each([
    "A: ${{ format('{{0}}', github.ref) }}",
    'A: ${{ fromJSON(needs.a.outputs.list)[0].name }}',
    "A: ${{ !cancelled() && (failure() || contains(github.ref, 'x')) }}",
    "A: ${{ needs.build-job.result == 'success' }}",
    'A: ${{ github.event.issue.labels.*.name }}',
    'A: ${{ a[*].b }}',
    'A: ${{ -1 < 0x1F && 1.5e3 > .5 }}',
    "A: ${{ secrets['MY-KEY'] }}",
    'A: ${{ !!a }}',
    'A: ${{ a }}-${{ b }}',
    'A: ${{ f() }}',
    "A: ${{ hashFiles('**/package-lock.json', '**/yarn.lock') }}",
    "A: ${{ 'it''s' == null }}",
  ])('accepts the well-formed expression %s', (line) => {
    expect(checkWorkflowExpressionSyntax('w.yml', `${line}\n`)).toEqual([]);
  });

  test('reports an if: that mixes an expression with other text, since it is always true', () => {
    const violations = violationsFor("    if: ${{ github.ref == 'x' }} && github.actor == 'y'\n");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toContain('a non-empty string is always true');
    expect(violationsFor("      - if: github.actor == 'y' && ${{ a }}\n")).toHaveLength(1);
  });

  test('reports an unquoted if: that starts with !, which YAML reads as a tag', () => {
    const violations = violationsFor('      - if: !cancelled()\n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('YAML reads as a tag');
  });

  test('accepts the if: shapes that are one expression, or none', () => {
    expect(violationsFor("    if: github.event_name == 'push'\n")).toEqual([]);
    expect(violationsFor("    if: '${{ !cancelled() }}'\n")).toEqual([]);
    expect(violationsFor('    if: "${{ always() }}" # keep going\n')).toEqual([]);
    expect(violationsFor('    if: ${{ always() }}\n')).toEqual([]);
  });

  test('does not read an if: line inside a block scalar as a key', () => {
    expect(violationsFor('      - run: |\n          if: ${{ a }} && b\n')).toEqual([]);
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
