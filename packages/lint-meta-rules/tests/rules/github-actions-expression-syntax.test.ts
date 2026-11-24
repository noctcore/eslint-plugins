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

  test('skips a ${{ in a YAML comment, which GitHub drops before it reads expressions', () => {
    expect(violationsFor('    # ${{ github.ref\n')).toEqual([]);
    expect(violationsFor('# never write ${{ a = b }}\n')).toEqual([]);
    expect(violationsFor('    # wrap it in ${{ ... }}\n')).toEqual([]);
    expect(violationsFor('      - run: echo hi # ${{ x\n')).toEqual([]);
    expect(violationsFor('    if: ${{ always() }} # never inline ${{ }} in the\n')).toEqual([]);
    expect(violationsFor('    if: "${{ always() }}" # ${{ x\n')).toEqual([]);
    expect(violationsFor('      - run: | # ${{ x\n          echo ok\n')).toEqual([]);
    expect(violationsFor("    branches: [main, 'a #b'] # ${{\n")).toEqual([]);
  });

  test('still reads a # line inside a block scalar, which is literal text GitHub evaluates', () => {
    const run = violationsFor('      - run: |\n          # comment-in-run ${{ github.ref\n          echo ok\n');

    expect(run).toHaveLength(1);
    expect(run[0]?.line).toBe(6);
    expect(violationsFor('      - run: >-\n          # never ${{ }}\n')[0]?.message ?? '').toContain('`${{ }}` is empty');
    expect(violationsFor('      - run: |\n          echo # ${{ a = b }}\n')[0]?.message ?? '').toContain('uses `=`');
  });

  test('keeps a # inside a quoted value as text', () => {
    expect(violationsFor('    if: "${{ github.ref == \'a #b\' }}"\n')).toEqual([]);
    expect(violationsFor("    if: '${{ github.ref == ''a #b'' }}'\n")).toEqual([]);
    expect(violationsFor('      - run: "echo # ${{ x"\n')).toHaveLength(1);
  });

  test('reports an expression a plain-value comment cuts short as unclosed', () => {
    const violations = violationsFor("    if: ${{ github.ref == 'a #b' }}\n");

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toMatch(/^line 5: `\$\{\{` has no closing `\}\}`/u);
    expect(violations[0]?.message ?? '').toContain('` #` starts a comment');
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

  test('reads a number glued to name characters as one invalid token', () => {
    expect(checkWorkflowExpressionSyntax('w.yml', 'A: ${{ 123abc }}\n')[0]?.message ?? '').toContain(
      'holds `123abc`, which is not valid',
    );
    expect(checkWorkflowExpressionSyntax('w.yml', 'A: ${{ 1-2 }}\n')[0]?.message ?? '').toContain('holds `1-2`');
  });

  test('tokenizes a long digit run in linear time', () => {
    const started = performance.now();
    const violations = checkWorkflowExpressionSyntax('w.yml', `A: \${{ ${'1'.repeat(100_000)}x }}\n`);

    expect(violations).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1000);
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
    expect(violationsFor("    steps:\n      - if: github.actor == 'y' && ${{ a }}\n")).toHaveLength(1);
  });

  test('reports an unquoted if: that starts with !, which YAML reads as a tag', () => {
    const violations = violationsFor('    steps:\n      - if: !cancelled()\n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('YAML reads as a tag');
  });

  test('accepts the if: shapes that are one expression, or none', () => {
    expect(violationsFor("    if: github.event_name == 'push'\n")).toEqual([]);
    expect(violationsFor("    if: '${{ !cancelled() }}'\n")).toEqual([]);
    expect(violationsFor('    if: "${{ always() }}" # keep going\n')).toEqual([]);
    expect(violationsFor('    if: ${{ always() }}\n')).toEqual([]);
  });

  test("reads '' in a single-quoted YAML value as the one quote GitHub sees", () => {
    expect(violationsFor("    if: '${{ !cancelled() && github.ref == ''refs/heads/main'' }}'\n")).toEqual([]);
    expect(violationsFor("      - run: 'echo ${{ github.ref == ''x'' }}'\n")).toEqual([]);
    expect(violationsFor("    if: '${{ a = ''x'' }}'\n")[0]?.message ?? '').toContain('uses `=`');
    expect(violationsFor("    if: '${{ a }} && b == ''x'''\n")[0]?.message ?? '').toContain('always true');
  });

  test('reads a CRLF workflow like an LF one', () => {
    expect(violationsFor('    steps:\r\n      - if: !cancelled()\r\n')).toHaveLength(1);
    expect(violationsFor('    if: ${{ a }} && b\r\n')).toHaveLength(1);
    expect(violationsFor('    if: >-\r\n      ${{ a &&\r\n      b }}\r\n    runs-on: x\r\n')).toEqual([]);
  });

  test('does not read an if: line inside a block scalar as a key', () => {
    expect(violationsFor('      - run: |\n          if: ${{ a }} && b\n')).toEqual([]);
  });

  test('ends a block scalar before a trailing comment indented between its key and its content', () => {
    const body = [
      '    steps:',
      '      - run: |',
      '          echo ok',
      '         # ${{ matrix.os == }} and ${{ }}',
      '        shell: bash',
      '',
    ].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test('reads a block scalar after an anchor or a tag as text, # lines included', () => {
    for (const props of ['&s', '!!str']) {
      const body = [
        '    steps:',
        `      - run: ${props} |`,
        "          echo \"${{ format('{0} #', github.sha) }}\"",
        "          # ${{ format('{0} #', github.sha) }}",
        '        shell: bash',
        '',
      ].join('\n');

      expect(violationsFor(body)).toEqual([]);
    }
  });

  test("does not open a quoted scalar at a plain scalar's continuation line that starts with a quote", () => {
    const body = ['    steps:', '      - run: echo one', "          'two", '      - run: echo ok # ${{ }}', ''].join(
      '\n',
    );

    expect(violationsFor(body)).toEqual([]);
  });

  test('keeps a # inside a quoted item of a flow list that spans lines', () => {
    const body = ['    branches: [a,', "      b, \"${{ format('a #b', x) }}\"]", ''].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test('reads a # after a non-breaking space as text in a plain value, not as a comment', () => {
    expect(violationsFor("    if: ${{ github.ref == 'a #b' }}\n")).toEqual([]);
  });

  test('gives the quote hint only when the comment cut that expression short', () => {
    const cut = violationsFor('    if: ${{ always() # keep going }}\n');

    expect(cut).toHaveLength(1);
    expect(cut[0]?.message ?? '').toContain('` #` starts a comment');

    const unrelated = violationsFor('      - run: echo ${{ a ${{ b }} # note\n');

    expect(unrelated).toHaveLength(1);
    expect(unrelated[0]?.message ?? '').toContain('has no closing');
    expect(unrelated[0]?.message ?? '').not.toContain('` #` starts a comment');
  });

  test('reads a double-quoted value with its escapes decoded, as GitHub gets it', () => {
    expect(violationsFor('      - run: "echo \\"${{ format(\'a\\"b\', x) }}\\""\n')).toEqual([]);
    expect(violationsFor('      - run: "${{ a \\x3D b }}"\n')[0]?.message ?? '').toContain('uses `=`');
    expect(violationsFor('      - run: "${{ \\x27a }}"\n')[0]?.message ?? '').toContain('a string inside');
    expect(violationsFor('      - run: "echo $\\\n          {{ x"\n')).toHaveLength(1);
  });

  test('reports at the source line inside a quoted value that wraps over lines', () => {
    const violations = violationsFor('      - run: "echo ok\n          ${{ a = b }}"\n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
  });

  test('checks an if: that wraps over lines or sits in a block scalar for mixed text', () => {
    const wrapped = violationsFor("    if: ${{ github.ref == 'x' }}\n      && github.actor == 'y'\n");

    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.line).toBe(5);
    expect(wrapped[0]?.message ?? '').toContain('always true');
    expect(violationsFor('    if: >-\n      ${{ a }} &&\n      b\n')[0]?.message ?? '').toContain('always true');
    expect(violationsFor('    if: |-\n      ${{ a &&\n      b }}\n')).toEqual([]);
  });

  test.each([
    ['a | block, whose clip keeps one newline', '    if: |\n      ${{ a &&\n      b }}\n', 'Write `|-` or `>-`'],
    ['a > block', '    if: >\n      ${{ a }}\n', 'Write `|-` or `>-`'],
    ['a >+ block', '    if: >+\n      ${{ a }}\n\n', 'Write `|-` or `>-`'],
    ['a quoted value with a trailing space', '    if: "${{ a }} "\n', 'Remove the padding'],
    ['a quoted value with a leading space', '    if: " ${{ a }}"\n', 'Remove the padding'],
  ])('reports an if: in %s as always true, since GitHub keeps the text outside ${{ }}', (_, body, fix) => {
    const violations = violationsFor(body);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toContain('a non-empty string is always true');
    expect(violations[0]?.message ?? '').toContain(fix);
  });

  test('reports a block if: with spaces after its ${{ }} as padding, even in a |- block', () => {
    const violations = violationsFor('    if: |-\n      ${{ a }}  \n');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('Remove the padding');
    expect(violations[0]?.message ?? '').not.toContain('Write `|-` or `>-`');
  });

  test('accepts an if: in a |- or >- block, and a block if: with no ${{ }}', () => {
    expect(violationsFor('    if: |-\n      ${{ a }}\n')).toEqual([]);
    expect(violationsFor('    if: >-\n      ${{ a &&\n      b }}\n')).toEqual([]);
    expect(violationsFor("    if: |\n      github.ref == 'refs/heads/main'\n")).toEqual([]);
    expect(violationsFor("    if: >\n      github.event_name == 'push' &&\n      github.ref == 'x'\n")).toEqual([]);
  });

  test('reads if: as a condition only at job and step level, not as an action input', () => {
    const input = ['    steps:', '      - uses: some/action@v1', '        with:', "          if: ${{ a }} && b", ''].join('\n');

    expect(violationsFor(input)).toEqual([]);
    expect(checkWorkflowExpressionSyntax('w.yml', 'on:\n  if: ${{ a }} && b\n')).toEqual([]);
    expect(violationsFor('    if: ${{ a }} && b\n')).toHaveLength(1);
    expect(violationsFor('    steps:\n      - run: echo\n        if: ${{ a }} && b\n')).toHaveLength(1);
  });

  test('accepts an if: with a core YAML tag, which YAML resolves', () => {
    expect(violationsFor('    if: !!str ${{ always() }}\n')).toEqual([]);
  });

  test('reports a duplicate key, comparing keys without case as GitHub does', () => {
    const duplicate = violationsFor('    runs-on: ubuntu-24.04\n    runs-on: ubuntu-22.04\n');

    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.line).toBe(6);
    expect(duplicate[0]?.message ?? '').toMatch(/^line 6: the key `runs-on` repeats `runs-on` from line 5, /u);
    expect(duplicate[0]?.message ?? '').toContain('GitHub fails to load a workflow like this');

    const cased = checkWorkflowExpressionSyntax('w.yml', 'on: push\nOn: pull_request\njobs: {}\n');

    expect(cased).toHaveLength(1);
    expect(cased[0]?.line).toBe(2);
    expect(cased[0]?.message ?? '').toContain('the key `On` repeats `on` from line 1');
  });

  test('skips keys holding an expression in the duplicate check, as GitHub does', () => {
    const body = ['    env:', '      ${{ matrix.key }}: 1', '      ${{ matrix.key }}: 2', ''].join('\n');

    expect(violationsFor(body)).toEqual([]);
  });

  test.each([
    ['more than one document', 'a: 1\n---\nb: 2\n', 'more than one YAML document'],
    ['an unclosed double quote', 'a: "x\n', 'Missing closing "quote'],
    ['an unclosed single quote', "a: 'x\nb: 1\n", "Missing closing 'quote"],
    ['an unclosed flow sequence', 'a: [b\nc: 1\n', 'end with a ]'],
    ['an unclosed flow map', 'a: {b: 1\n', 'end with a }'],
    ['a tab as indentation', 'a:\n\t- b\n', 'Tabs are not allowed'],
  ])('reports a workflow with %s, which GitHub cannot load', (_, text, detail) => {
    const violations = checkWorkflowExpressionSyntax('w.yml', text);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain(detail);
    expect(violations[0]?.message ?? '').toContain('GitHub fails to load a workflow like this');
  });

  test('reports an alias to an anchor that is not defined before it, which GitHub cannot load', () => {
    const undefinedAlias = checkWorkflowExpressionSyntax('w.yml', 'a: 1\nb: *x\n');

    expect(undefinedAlias).toHaveLength(1);
    expect(undefinedAlias[0]?.line).toBe(2);
    expect(undefinedAlias[0]?.message ?? '').toContain('the alias `*x` names no anchor defined before it');
    expect(checkWorkflowExpressionSyntax('w.yml', 'a: *x\nb: &x 1\n')).toHaveLength(1);
    expect(checkWorkflowExpressionSyntax('w.yml', 'a: &x 1\nb: *x\nc: &m {k: v}\nd: *m\ne: &s [1]\nf: *s\n')).toEqual([]);
  });

  test.each([
    ['a block header with a comment and no space', 'a:\n  run: |# note\n    echo ok\n'],
    ['a quoted value followed by a comment with no space', 'key: "x"#c\n'],
    ['a multi-line implicit key in a flow sequence', 'a: [ b\n  c: d ]\n'],
    ['an implicit key over 1024 characters', `${'k'.repeat(1100)}: 1\n`],
    ['a flow map continued below its parent key', 'jobs:\n  env: {A: 1,\n B: 2}\n'],
    ['a flow sequence continued at its key column', 'on:\n  push:\n    branches: [main,\n    dev]\n'],
    ['a closing bracket dedented past its parent', 'on:\n  push:\n    branches: [main,\n      dev\n  ]\n'],
    ['a quoted value continued below its key', "jobs:\n  b:\n    run: 'echo\n  ok'\n"],
    ['a comment right after a flow comma', 'a: [x,#c\n  y]\n'],
  ])('accepts %s, which GitHub reads', (_, text) => {
    expect(checkWorkflowExpressionSyntax('w.yml', text)).toEqual([]);
  });

  test.each([
    ['a --- line in a double-quoted value', '    steps:\n      - run: "echo\n---\n  done"\n', 7],
    ['a ... line in a double-quoted value', '    steps:\n      - run: "a\n... more ${{ a }}"\n', 7],
    ['a ... line in a single-quoted value', "    steps:\n      - run: 'a\n...\n  b'\n", 7],
    ['a --- line in a flow sequence', '    branches: [push,\n---\n  pull_request]\n', 6],
    ['a --- x line in a flow sequence', '    branches: [push,\n--- x]\n', 6],
    ['a ... line in a flow sequence', '    branches: [push,\n...\n  pull_request]\n', 6],
    ['a ... x line in a flow map', '    env: {A: 1,\n... x}\n', 6],
  ])('reports %s as a document marker, never repairing it away', (_, body, line) => {
    const violations = violationsFor(body);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(line);
    expect(violations[0]?.message ?? '').toContain('is a YAML document marker');
    expect(violations[0]?.message ?? '').toContain('GitHub fails to load a workflow like this');
  });

  test('repairs a flow list of 250 under-indented lines in one go', () => {
    const items = Array.from({ length: 250 }, (_, index) => `    b${String(index)},`);
    const text = ['on:', '  push:', '    branches: [main,', ...items, '    last]', 'jobs:', '  b:', '    if: ${{ a = b }}', ''];
    const started = performance.now();
    const violations = checkWorkflowExpressionSyntax('w.yml', text.join('\n'));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(257);
    expect(violations[0]?.message ?? '').toContain('uses `=`');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('still checks expressions in a workflow whose flow or quoted indentation only yaml rejects', () => {
    const quoted = checkWorkflowExpressionSyntax('w.yml', 'jobs:\n  b:\n    run: "echo\n  ${{ a = b }}"\n');

    expect(quoted).toHaveLength(1);
    expect(quoted[0]?.line).toBe(4);
    expect(quoted[0]?.message ?? '').toContain('uses `=`');

    const flow = checkWorkflowExpressionSyntax('w.yml', 'jobs:\n  env: {A: 1,\n B: "${{ }}"}\n');

    expect(flow).toHaveLength(1);
    expect(flow[0]?.line).toBe(3);
  });

  test('reads an empty or comment-only workflow without reporting', () => {
    expect(checkWorkflowExpressionSyntax('w.yml', '')).toEqual([]);
    expect(checkWorkflowExpressionSyntax('w.yml', '# nothing yet\n')).toEqual([]);
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
