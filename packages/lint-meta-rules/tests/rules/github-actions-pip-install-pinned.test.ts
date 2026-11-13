import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { createGithubActionsPipInstallPinnedRule } from '../../src/rules/github-actions-pip-install-pinned';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { diskCtx } from '../test-utils/diskFixture';

const RULE_ID = 'github-actions-pip-install-pinned';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI = '.github/workflows/ci.yml';

function workflow(steps: string): string {
  return `name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n${steps}`;
}

function run(steps: string, options = {}, file = CI) {
  return createGithubActionsPipInstallPinnedRule(options).run(
    createFakeCtx({ files: { [file]: workflow(steps) } }),
  );
}

function names(violations: readonly { message: string }[]): string[] {
  return violations.map((violation) => /"([^"]+)"/u.exec(violation.message)?.[1] ?? '');
}

describe('github-actions-pip-install-pinned', () => {
  test('reports each bare package of an inline pip install, with the file and line', () => {
    const violations = run('      - run: pip install yamllint semgrep\n');

    expect(violations).toHaveLength(2);
    for (const violation of violations) {
      expect(violation.file).toBe(CI);
      expect(violation.rule).toBe(RULE_ID);
      expect(violation.line).toBe(7);
      expect(violation.message).toMatch(/^line 7: /u);
    }
    expect(violations[0]?.message).toContain('yamllint');
    expect(violations[1]?.message).toContain('semgrep');
  });

  test('passes == pins, including a shell variable as the version', () => {
    const violations = run(
      '      - run: pip install yamllint==1.35.1 semgrep==${SEMGREP_VERSION} control\n',
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('control');
  });

  test('reads every installer', () => {
    const violations = run(
      [
        '      - run: |',
        '          pip3 install a',
        '          python -m pip install b',
        '          python3 -m pip install c',
        '          uv pip install d',
        '          pipx install e',
        '          pip install f',
        '',
      ].join('\n'),
    );

    expect(names(violations)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(violations.map((violation) => violation.line)).toEqual([8, 9, 10, 11, 12, 13]);
  });

  test('skips a leading sudo and variable assignments', () => {
    const violations = run(
      '      - run: |\n          sudo pip install a\n          PIP_NO_CACHE_DIR=1 pip install b\n',
    );

    expect(names(violations)).toEqual(['a', 'b']);
  });

  test('reads a run: | block scalar and reports the block line', () => {
    const violations = run(
      '      - run: |\n          echo start\n          pip install bare\n',
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(9);
  });

  test('joins backslash continuations and reports each package at its own line', () => {
    const violations = run(
      '      - run: |\n          pip install \\\n            alpha \\\n            beta==1.0 \\\n            gamma\n',
    );

    expect(names(violations)).toEqual(['alpha', 'gamma']);
    expect(violations.map((violation) => violation.line)).toEqual([9, 11]);
  });

  test('stops a command at &&, ||, ; and |', () => {
    const violations = run(
      [
        '      - run: |',
        '          pip install a==1 && echo hello world',
        '          pip install a==1 || true',
        '          pip install a==1; ls build',
        '          pip install a==1 | tee log',
        '          pip install a==1 && pip install control',
        '',
      ].join('\n'),
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('skips flags and the value of a flag that takes one', () => {
    const violations = run(
      '      - run: pip install --upgrade --no-cache-dir -r reqs -c constraints -i internal --index-url mirror --extra-index-url mirror2 -t vendor --target vendor2 --python py311 --no-binary :all: control\n',
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('skips an --option=value form and stops at a redirection', () => {
    const violations = run(
      '      - run: pip install --index-url=https://mirror control 2>&1 later\n',
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('skips paths, .txt files, . and -e .', () => {
    const violations = run(
      '      - run: pip install ./local git+https://github.com/a/b.git requirements.txt . -e . control\n',
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('skips a package that is a shell variable or a ${{ }} expression', () => {
    const violations = run(
      '      - run: pip install $PKGS "${EXTRA}" ${{ matrix.pkg }} "tool==${{ inputs.v }}" ${{ a || b }} control\n',
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('skips shell command substitution', () => {
    const violations = run('      - run: pip install $(cat reqs) control\n');

    expect(names(violations)).toEqual(['control']);
  });

  test('counts pkg[extra]==1.0 as pinned and reports pkg[extra]', () => {
    const violations = run('      - run: pip install "uvicorn[standard]==0.30.0" "httpx[http2]"\n');

    expect(names(violations)).toEqual(['httpx']);
  });

  test('names the >= and ~= operators and asks for ==', () => {
    const violations = run('      - run: pip install "a>=1.0" "b~=2.0" "c!=1.0"\n');

    expect(violations).toHaveLength(3);
    expect(violations[0]?.message).toContain('>=');
    expect(violations[0]?.message).toContain('==');
    expect(violations[1]?.message).toContain('~=');
    expect(violations[1]?.message).toContain('==');
    expect(violations[2]?.message).toContain('no version pin');
    expect(violations[2]?.message).not.toContain('!=');
  });

  test('ignores a commented-out install and install text outside run:', () => {
    const steps = [
      '      - name: pip install foo',
      '        run: |',
      '          # pip install foo',
      '          echo done # pip install foo',
      '          pip install control',
      '',
    ].join('\n');
    const withDefaults = `name: ci\non: push\ndefaults:\n  run:\n    shell: bash\njobs:\n  build:\n    steps:\n${steps}`;
    const violations = createGithubActionsPipInstallPinnedRule().run(
      createFakeCtx({ files: { [CI]: withDefaults } }),
    );

    expect(names(violations)).toEqual(['control']);
  });

  test('installers replaces the default list', () => {
    const line = '      - run: pip install control\n      - run: uv pip install bare\n';

    expect(names(run(line, { installers: ['pip'] }))).toEqual(['control']);
    expect(names(run(line))).toEqual(['control', 'bare']);
    expect(names(run('      - run: uv pip install bare\n', { installers: ['pip'] }))).toEqual([]);
    expect(names(run('      - run: pipx install bare\n', { installers: ['pipx install'] }))).toEqual([
      'bare',
    ]);
  });

  test('workflowGlobs defaults to .github/workflows and can be retargeted', () => {
    const steps = '      - run: pip install bare\n';
    const files = { 'ci/build.yml': workflow(steps) };

    expect(createGithubActionsPipInstallPinnedRule().run(createFakeCtx({ files }))).toEqual([]);

    const violations = createGithubActionsPipInstallPinnedRule({ workflowGlobs: ['ci/*.yml'] }).run(
      createFakeCtx({ files }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('ci/build.yml');
  });

  test('ciCritical defaults false and is overridable', () => {
    expect(createGithubActionsPipInstallPinnedRule().ciCritical).toBe(false);
    expect(createGithubActionsPipInstallPinnedRule({ ciCritical: true }).ciCritical).toBe(true);
  });

  test("reports nothing on this repository's own workflows", () => {
    const ctx = diskCtx(REPO_ROOT);

    expect(ctx.glob('.github/workflows/*.yml').length).toBeGreaterThan(0);
    expect(createGithubActionsPipInstallPinnedRule().run(ctx)).toEqual([]);
  });
});
