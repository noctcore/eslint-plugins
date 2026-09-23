import { describe, expect, test } from 'bun:test';

import { createGithubActionsLeastPrivilegePermissionsRule } from '../../src/rules/github-actions-least-privilege-permissions';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createGithubActionsLeastPrivilegePermissionsRule();

const JOBS = 'jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: make\n';

function violationsFor(text: string) {
  return rule.run(createFakeCtx({ files: { '.github/workflows/ci.yml': text } }));
}

describe('github-actions-least-privilege-permissions', () => {
  describe('reports', () => {
    test('a workflow with no top-level permissions, naming the jobs left on the default', () => {
      const violations = violationsFor(`on: push\n${JOBS}  lint:\n    runs-on: ubuntu-24.04\n`);

      expect(violations.length).toBe(1);
      expect(violations[0]?.rule).toBe('github-actions-least-privilege-permissions');
      expect(violations[0]?.line).toBe(1);
      expect(violations[0]?.message ?? '').toMatch(/no top-level `permissions:`.*`build`, `lint` run/u);
    });

    test('only the jobs without their own permissions when some have them', () => {
      const violations = violationsFor(
        'on: push\njobs:\n  a:\n    permissions:\n      contents: read\n  b:\n    runs-on: ubuntu-24.04\n',
      );

      expect(violations.length).toBe(1);
      expect(violations[0]?.message ?? '').toContain('`b` runs');
      expect(violations[0]?.message ?? '').not.toContain('`a`');
    });

    test('write-all and read-all', () => {
      expect(violationsFor(`on: push\npermissions: write-all\n${JOBS}`).map((v) => v.line)).toEqual([2]);
      expect(violationsFor(`on: push\npermissions: 'read-all'\n${JOBS}`).length).toBe(1);
    });

    test('each top-level scope at write, on its own line', () => {
      const violations = violationsFor(
        `on: push\npermissions:\n  contents: write\n  pull-requests: read\n  id-token: write # oidc\n${JOBS}`,
      );

      expect(violations.map((v) => v.line)).toEqual([3, 5]);
      expect(violations[0]?.message ?? '').toContain('`contents: write`');
      expect(violations[1]?.message ?? '').toContain('`id-token: write`');
    });

    test('a write in a flow mapping', () => {
      expect(violationsFor(`on: push\npermissions: { contents: read, packages: write }\n${JOBS}`).length).toBe(1);
    });

    test('.yaml workflows too', () => {
      const ctx = createFakeCtx({ files: { '.github/workflows/a.yaml': `on: push\n${JOBS}` } });
      expect(rule.run(ctx)).toHaveLength(1);
    });
  });

  describe('leaves alone', () => {
    test('a read-only top level with writes on the job that needs them (the fix)', () => {
      expect(
        violationsFor(
          [
            'on: push',
            'permissions:',
            '  contents: read',
            'jobs:',
            '  deploy:',
            '    permissions:',
            '      pages: write',
            '      id-token: write',
            '    runs-on: ubuntu-24.04',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('an empty top level: {} and none', () => {
      expect(violationsFor(`on: push\npermissions: {}\n${JOBS}`)).toEqual([]);
      expect(violationsFor(`on: push\npermissions:\n  contents: none\n${JOBS}`)).toEqual([]);
    });

    test('no top level when every job declares its own permissions', () => {
      expect(
        violationsFor(
          'on: push\njobs:\n  a:\n    permissions: {}\n    steps:\n      - run: make\n  b:\n    permissions: read-all\n',
        ),
      ).toEqual([]);
    });

    test('a write in a job, a step input or a comment is not a top-level write', () => {
      expect(
        violationsFor(
          [
            'on: push',
            '# permissions: write-all',
            'permissions:',
            '  contents: read',
            'jobs:',
            '  a:',
            '    permissions:',
            '      contents: write',
            '    steps:',
            '      - uses: some/action@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v1.0.0',
            '        with:',
            '          permissions: write',
            '',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    test('a scope in allowTopLevelWrite', () => {
      const allowing = createGithubActionsLeastPrivilegePermissionsRule({
        allowTopLevelWrite: ['contents'],
      });
      const ctx = createFakeCtx({
        files: {
          '.github/workflows/release.yml': `on: push\npermissions:\n  contents: write\n  id-token: write\n${JOBS}`,
        },
      });

      expect(rule.run(ctx)).toHaveLength(2);
      expect(allowing.run(ctx).map((v) => v.line)).toEqual([4]);
    });

    test('a file with no jobs', () => {
      expect(violationsFor('on: push\n')).toEqual([]);
    });
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createGithubActionsLeastPrivilegePermissionsRule().ciCritical).toBe(true);
    expect(
      createGithubActionsLeastPrivilegePermissionsRule({ ciCritical: false }).ciCritical,
    ).toBe(false);
  });
});
