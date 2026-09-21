import { describe, expect, test } from 'bun:test';

import { createGithubActionsRunnerPinnedRule } from '../../src/rules/github-actions-runner-pinned';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createGithubActionsRunnerPinnedRule();

function violationsFor(text: string) {
  return rule.run(createFakeCtx({ files: { '.github/workflows/ci.yml': text } }));
}

describe('github-actions-runner-pinned', () => {
  test('reports ubuntu-latest, naming the label and the line', () => {
    const violations = violationsFor('jobs:\n  build:\n    runs-on: ubuntu-latest\n');

    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('github-actions-runner-pinned');
    expect(violations[0]?.message ?? '').toMatch(/line 3: .*"ubuntu-latest"/u);
  });

  test('reports every floating OS, not only ubuntu', () => {
    const violations = violationsFor(
      'jobs:\n  a:\n    runs-on: macos-latest\n  b:\n    runs-on: windows-latest\n',
    );

    expect(violations.length).toBe(2);
  });

  test('passes a pinned runner, a trailing comment and a quoted value', () => {
    expect(
      violationsFor(
        'jobs:\n  a:\n    runs-on: ubuntu-24.04 # pinned\n  b:\n    runs-on: "ubuntu-24.04"\n',
      ),
    ).toEqual([]);
  });

  test('reads a flow list and a block list of labels', () => {
    const flow = violationsFor('jobs:\n  a:\n    runs-on: [self-hosted, ubuntu-latest]\n');
    const block = violationsFor(
      'jobs:\n  a:\n    runs-on:\n      - self-hosted\n      - ubuntu-latest\n    steps: []\n',
    );
    const group = violationsFor(
      'jobs:\n  a:\n    runs-on:\n      group: big\n      labels: ubuntu-latest\n',
    );

    expect(flow.length).toBe(1);
    expect(block.length).toBe(1);
    expect(group.length).toBe(1);
  });

  test('leaves an expression and a commented-out runner alone', () => {
    expect(
      violationsFor('jobs:\n  a:\n    # runs-on: ubuntu-latest\n    runs-on: ${{ matrix.os }}\n'),
    ).toEqual([]);
  });

  test('does not read a later key as a runner label', () => {
    expect(
      violationsFor('jobs:\n  a:\n    runs-on:\n      - self-hosted\n    name: ubuntu-latest\n'),
    ).toEqual([]);
  });

  test('reads .yaml workflows too', () => {
    const ctx = createFakeCtx({
      files: { '.github/workflows/a.yaml': 'jobs:\n  a:\n    runs-on: ubuntu-latest\n' },
    });
    expect(rule.run(ctx)).toHaveLength(1);
  });

  test('honors a custom floatingLabel pattern', () => {
    const custom = createGithubActionsRunnerPinnedRule({
      floatingLabel: /^(?:[\w.-]+-latest|self-hosted)$/u,
    });
    const ctx = createFakeCtx({
      files: {
        '.github/workflows/ci.yml': 'jobs:\n  a:\n    runs-on: [self-hosted, ubuntu-24.04]\n',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
    expect(custom.run(ctx)).toHaveLength(1);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsRunnerPinnedRule().ciCritical).toBe(true);
    expect(createGithubActionsRunnerPinnedRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
