import { describe, expect, test } from 'bun:test';

import { createGithubActionsNoTemplateInjectionRule } from '../../src/rules/github-actions-no-template-injection';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createGithubActionsNoTemplateInjectionRule();

const HEAD = 'on: pull_request_target\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n';

function violationsFor(steps: string, head = HEAD) {
  return rule.run(createFakeCtx({ files: { '.github/workflows/ci.yml': `${head}${steps}` } }));
}

describe('github-actions-no-template-injection', () => {
  describe('reports', () => {
    test('an inline run: that expands a PR title, naming the context and the line', () => {
      const violations = violationsFor(
        '      - run: echo "${{ github.event.pull_request.title }}"\n',
      );

      expect(violations.length).toBe(1);
      expect(violations[0]?.rule).toBe('github-actions-no-template-injection');
      expect(violations[0]?.line).toBe(6);
      expect(violations[0]?.message ?? '').toMatch(
        /line 6: .*`github\.event\.pull_request\.title`.*`run:` script.*env:/u,
      );
    });

    test('every line of a run: | block, including a shell comment', () => {
      const violations = violationsFor(
        [
          '      - name: greet',
          '        run: |',
          '          # ${{ github.event.issue.body }}',
          '          echo "${{ github.head_ref }}"',
          '          echo "${{ github.event.comment.body }}"',
          '',
        ].join('\n'),
      );

      expect(violations.map((v) => v.line)).toEqual([8, 9, 10]);
    });

    test('each attacker-controllable event field the rule knows', () => {
      const fields = [
        'github.event.issue.title',
        'github.event.pull_request.body',
        'github.event.pull_request.head.ref',
        'github.event.pull_request.head.label',
        'github.event.discussion.title',
        'github.event.review.body',
        'github.event.review_comment.body',
        'github.event.pages.*.page_name',
        'github.event.pages[0].page_name',
        'github.event.commits.*.message',
        'github.event.commits[0].author.email',
        'github.event.head_commit.message',
        'github.event.head_commit.author.name',
        'github.event.workflow_run.head_branch',
        'github.event.workflow_run.head_commit.message',
      ];
      const violations = violationsFor(
        fields.map((field) => `      - run: echo \${{ ${field} }}\n`).join(''),
      );

      expect(violations.length).toBe(fields.length);
    });

    test('a folded run: >- block and a multi-line plain scalar', () => {
      const folded = violationsFor(
        '      - run: >-\n          echo\n          ${{ github.head_ref }}\n',
      );
      const plain = violationsFor('      - run: echo\n          ${{ github.head_ref }}\n');

      expect(folded.map((v) => v.line)).toEqual([8]);
      expect(plain.map((v) => v.line)).toEqual([7]);
    });

    test('an actions/github-script script: input', () => {
      const violations = violationsFor(
        [
          '      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1',
          '        with:',
          '          script: |',
          '            console.log(`${{ github.event.issue.title }}`)',
          '',
        ].join('\n'),
      );

      expect(violations.length).toBe(1);
      expect(violations[0]?.message ?? '').toContain('`actions/github-script` `script:`');
    });

    test('an untyped or string input, in a workflow and in a composite action', () => {
      const workflow = violationsFor(
        '      - run: deploy ${{ inputs.target }} ${{ github.event.inputs.ref }}\n',
        'on:\n  workflow_call:\n    inputs:\n      target:\n        type: string\njobs:\n  a:\n    steps:\n',
      );
      const action = rule.run(
        createFakeCtx({
          files: {
            'actions/setup/action.yml': [
              'inputs:',
              '  version:',
              '    description: which',
              'runs:',
              '  using: composite',
              '  steps:',
              '    - run: install ${{ inputs.version }}',
              '      shell: bash',
              '',
            ].join('\n'),
          },
        }),
      );

      expect(workflow.length).toBe(2);
      expect(workflow[0]?.message ?? '').toContain('`inputs.target`');
      expect(workflow[1]?.message ?? '').toContain('`github.event.inputs.ref`');
      expect(action.map((v) => [v.file, v.line])).toEqual([['actions/setup/action.yml', 7]]);
    });

    test('step outputs, once checkStepOutputs is on', () => {
      const strict = createGithubActionsNoTemplateInjectionRule({ checkStepOutputs: true });
      const ctx = createFakeCtx({
        files: { '.github/workflows/ci.yml': `${HEAD}      - run: echo \${{ steps.meta.outputs.title }}\n` },
      });

      expect(strict.run(ctx).length).toBe(1);
    });

    test('.yaml workflows and action.yaml files too', () => {
      const ctx = createFakeCtx({
        files: {
          '.github/workflows/a.yaml': `${HEAD}      - run: echo \${{ github.head_ref }}\n`,
          'action.yaml': 'runs:\n  steps:\n    - run: echo ${{ github.event.issue.title }}\n',
        },
      });

      expect(rule.run(ctx).map((v) => v.file)).toEqual(['.github/workflows/a.yaml', 'action.yaml']);
    });
  });

  describe('leaves alone', () => {
    test('the same expression routed through env: and read as a variable (the fix)', () => {
      expect(
        violationsFor(
          [
            '      - env:',
            '          TITLE: ${{ github.event.pull_request.title }}',
            '        run: echo "$TITLE"',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('the same expression in with:, if: and name:', () => {
      expect(
        violationsFor(
          [
            '      - name: ${{ github.event.issue.title }}',
            "        if: contains(github.event.comment.body, '/deploy')",
            '        uses: actions/labeler@8558fd74291d67161a8a78ce36a881fa63b766a9 # v5.0.0',
            '        with:',
            '          title: ${{ github.event.pull_request.title }}',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('safe contexts: github.sha, matrix, secrets, and step outputs by default', () => {
      expect(
        violationsFor(
          [
            '      - run: |',
            '          echo ${{ github.sha }} ${{ github.ref_name }} ${{ github.event.pull_request.number }}',
            '          echo ${{ matrix.node }} ${{ secrets.TOKEN }} ${{ steps.meta.outputs.title }}',
            '          echo ${{ github.event.pull_request.head.sha }} ${{ github.event.pull_request.head.repo.full_name }}',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('a script: input of an action that is not github-script', () => {
      expect(
        violationsFor(
          [
            '      - uses: some/runner@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v1.0.0',
            '        with:',
            '          script: echo ${{ github.event.issue.title }}',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('inputs declared boolean, number or choice', () => {
      expect(
        violationsFor(
          '      - run: deploy ${{ inputs.dry-run }} ${{ inputs.count }} ${{ inputs.env }}\n',
          [
            'on:',
            '  workflow_dispatch:',
            '    inputs:',
            '      dry-run:',
            '        type: boolean',
            '      count:',
            '        type: number',
            '      env:',
            '        type: choice',
            '        options: [staging, prod]',
            'jobs:',
            '  a:',
            '    steps:',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('any input, once checkInputs is off', () => {
      const loose = createGithubActionsNoTemplateInjectionRule({ checkInputs: false });
      const ctx = createFakeCtx({
        files: { '.github/workflows/ci.yml': `${HEAD}      - run: deploy \${{ inputs.target }}\n` },
      });

      expect(rule.run(ctx).length).toBe(1);
      expect(loose.run(ctx)).toEqual([]);
    });

    test('a defaults.run mapping, a commented-out run: and a trailing YAML comment', () => {
      expect(
        violationsFor(
          [
            '      # - run: echo ${{ github.head_ref }}',
            '      - run: echo hi # ${{ github.head_ref }}',
            '',
          ].join('\n'),
          [
            'on: push',
            'defaults:',
            '  run:',
            '    shell: bash',
            '    working-directory: ${{ github.head_ref }}',
            'jobs:',
            '  a:',
            '    steps:',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('run: text inside a script body is not read as a second key', () => {
      const violations = violationsFor(
        '      - run: |\n          cat <<EOF\n          run: ${{ github.head_ref }}\n          EOF\n',
      );

      expect(violations.length).toBe(1);
    });

    test('an action.yml under node_modules', () => {
      const ctx = createFakeCtx({
        files: {
          'node_modules/x/action.yml': 'runs:\n  steps:\n    - run: echo ${{ github.head_ref }}\n',
        },
      });

      expect(rule.run(ctx)).toEqual([]);
    });
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsNoTemplateInjectionRule().ciCritical).toBe(true);
    expect(createGithubActionsNoTemplateInjectionRule({ ciCritical: false }).ciCritical).toBe(
      false,
    );
  });
});
