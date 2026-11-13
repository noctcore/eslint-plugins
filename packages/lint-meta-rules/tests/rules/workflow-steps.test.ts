import { describe, expect, test } from 'bun:test';

import { workflowJobPermissions } from '../../src/rules/workflow-steps';

function read(text: string) {
  return workflowJobPermissions(text.split('\n'));
}

describe('workflowJobPermissions', () => {
  test("returns each job's name and line range", () => {
    const jobs = read(
      ['name: ci', 'on: push', 'jobs:', '  lint:', '    runs-on: x', '  "test":', '    runs-on: x', ''].join('\n'),
    );

    expect(jobs.map((j) => j.name)).toEqual(['lint', 'test']);
    expect(jobs[0]?.start).toBe(3);
    expect(jobs[0]?.end).toBe(jobs[1]?.start);
    expect(jobs[1]?.end).toBe(8);
  });

  test('stops at the next top-level key', () => {
    const jobs = read(['jobs:', '  a:', '    runs-on: x', 'env:', '  A: b'].join('\n'));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.end).toBe(3);
  });

  test('a job-level block replaces the workflow-level one', () => {
    const [job] = read(
      [
        'permissions: { contents: read, pull-requests: read }',
        'jobs:',
        '  filter:',
        '    permissions:',
        '      contents: read',
        '    runs-on: x',
      ].join('\n'),
    );

    expect(job?.source).toBe('job');
    const own = job?.permissions;
    expect(own?.kind === 'scopes' && own.scopes.size).toBe(1);
    expect(own?.kind === 'scopes' && own.scopes.has('pull-requests')).toBe(false);
    const workflow = job?.workflow;
    expect(workflow?.kind === 'scopes' && workflow.scopes.get('pull-requests')).toBe('read');
  });

  test('a job without a block inherits the workflow-level permissions', () => {
    const [job] = read(['permissions:', '  pull-requests: read', 'jobs:', '  a:', '    runs-on: x'].join('\n'));

    expect(job?.source).toBe('workflow');
    expect(job?.permissions).toBe(job?.workflow ?? undefined);
    const scopes = job?.permissions;
    expect(scopes?.kind === 'scopes' && scopes.scopes.get('pull-requests')).toBe('read');
  });

  test('no permissions at either level gives null', () => {
    const [job] = read(['jobs:', '  a:', '    runs-on: x'].join('\n'));

    expect(job?.permissions).toBeNull();
    expect(job?.source).toBeNull();
    expect(job?.workflow).toBeNull();
  });

  test('reads block mappings, single-line flow mappings, {} and quoted values', () => {
    const jobs = read(
      [
        'jobs:',
        '  block:',
        '    permissions:',
        '      # a comment',
        '      contents: read',
        '',
        '      pull-requests: write # why',
        '  flow:',
        "    permissions: { contents: read, 'pull-requests': \"read\" }",
        '  empty:',
        '    permissions: {}',
      ].join('\n'),
    );
    const scopes = jobs.map((j) => (j.permissions?.kind === 'scopes' ? Object.fromEntries(j.permissions.scopes) : null));

    expect(scopes[0]).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(scopes[1]).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(scopes[2]).toEqual({});
  });

  test('reads read-all and write-all, quoted or not', () => {
    const jobs = read(
      ['jobs:', '  a:', '    permissions: read-all', '  b:', '    permissions: "write-all"'].join('\n'),
    );

    expect(jobs[0]?.permissions).toEqual({ kind: 'all', level: 'read' });
    expect(jobs[1]?.permissions).toEqual({ kind: 'all', level: 'write' });
  });

  test('a flow mapping wrapped over lines and an unknown scalar are unknown', () => {
    const jobs = read(
      ['jobs:', '  a:', '    permissions: { contents: read,', '      pull-requests: read }', '  b:', '    permissions: ${{ x }}'].join(
        '\n',
      ),
    );

    expect(jobs[0]?.permissions?.kind).toBe('unknown');
    expect(jobs[1]?.permissions?.kind).toBe('unknown');
  });

  test('a permissions key nested under a step is not job-level', () => {
    const [job] = read(
      [
        'jobs:',
        '  a:',
        '    runs-on: x',
        '    steps:',
        '      - uses: some/action@v1',
        '        with:',
        '          permissions: write-all',
      ].join('\n'),
    );

    expect(job?.permissions).toBeNull();
  });

  test('a file without jobs gives no jobs', () => {
    expect(read('name: ci\non: push\n')).toEqual([]);
  });
});
