import { describe, expect, test } from 'bun:test';

import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

/*
 * Reachability tests for the CI-hygiene rules, on a REAL temp directory run
 * through the real harness CLI under Bun. The per-rule `createFakeCtx` tests
 * cover the logic; these exist because a fake glob matches whatever it is handed.
 *
 * Under @noctcore/harness 0.2.0, Bun's glob returned `[]` for any dot-directory
 * segment, so every rule below saw no files: four reported nothing and
 * security-scanner-version-parity reported a false violation that hid a real
 * drift. Each test asserts a violation that only a working glob can produce, so
 * each one fails on 0.2.0 (run with LINT_META_HARNESS_CLI pointing at its
 * dist/cli.js) and passes on 0.3.0.
 */

// Spawning the CLI costs a Bun startup per test; give a slow runner room.
const TIMEOUT_MS = 30_000;

const WORKFLOW_HEAD = 'name: ci\non: push\njobs:\n  build:\n';

describe('CI rules on a real tree with a dot-directory', () => {
  test(
    'github-actions-sha-pinned reaches .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.github/workflows/ci.yml': `${WORKFLOW_HEAD}    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v6\n`,
        },
        'createGithubActionsShaPinnedRule',
      );

      expect(run.stdout).toContain('github-actions-sha-pinned');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.github/workflows/ci.yml)');
      expect(run.violations[0]).toContain('actions/checkout@v6');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'github-actions-runner-pinned reaches .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        { '.github/workflows/ci.yml': `${WORKFLOW_HEAD}    runs-on: ubuntu-latest\n` },
        'createGithubActionsRunnerPinnedRule',
      );

      expect(run.stdout).toContain('github-actions-runner-pinned');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.github/workflows/ci.yml)');
      expect(run.violations[0]).toContain('ubuntu-latest');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'github-actions-no-template-injection reaches .github/workflows and an action.yml in .github/actions',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.github/workflows/ci.yml': `${WORKFLOW_HEAD}    runs-on: ubuntu-24.04\n    steps:\n      - run: echo "\${{ github.head_ref }}"\n`,
          '.github/actions/setup/action.yml':
            'runs:\n  using: composite\n  steps:\n    - run: echo "${{ github.event.issue.title }}"\n      shell: bash\n',
        },
        'createGithubActionsNoTemplateInjectionRule',
      );

      expect(run.stdout).toContain('github-actions-no-template-injection');
      expect(run.violations).toHaveLength(2);
      expect(run.violations.join('\n')).toContain('(.github/workflows/ci.yml)');
      expect(run.violations.join('\n')).toContain('(.github/actions/setup/action.yml)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'github-actions-least-privilege-permissions reaches .github/workflows',
    () => {
      const run = runLintMetaOnRealTree(
        { '.github/workflows/ci.yml': `name: ci\non: push\npermissions: write-all\njobs:\n  build:\n    runs-on: ubuntu-24.04\n` },
        'createGithubActionsLeastPrivilegePermissionsRule',
      );

      expect(run.stdout).toContain('github-actions-least-privilege-permissions');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.github/workflows/ci.yml)');
      expect(run.violations[0]).toContain('write-all');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'service-image-digest-pin reaches .github/workflows and a compose file in .devcontainer',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.github/workflows/ci.yml': `${WORKFLOW_HEAD}    runs-on: ubuntu-24.04\n    services:\n      postgres:\n        image: postgres:17-alpine\n`,
          '.devcontainer/docker-compose.yml': 'services:\n  cache:\n    image: redis:7\n',
        },
        'createServiceImageDigestPinRule',
      );

      expect(run.stdout).toContain('service-image-digest-pin');
      expect(run.violations).toHaveLength(2);
      expect(run.violations.join('\n')).toContain('(.github/workflows/ci.yml)');
      expect(run.violations.join('\n')).toContain('(.devcontainer/docker-compose.yml)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'dockerfile-base-image-digest-pin reaches a Dockerfile in .devcontainer',
    () => {
      const run = runLintMetaOnRealTree(
        { '.devcontainer/Dockerfile': 'FROM node:22-slim\nRUN echo hi\n' },
        'createDockerfileBaseImageDigestPinRule',
      );

      expect(run.stdout).toContain('dockerfile-base-image-digest-pin');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(.devcontainer/Dockerfile)');
      expect(run.violations[0]).toContain('node:22-slim');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'security-scanner-version-parity reports the real 8.19.0 vs 8.18.0 drift, not a false "no workflow pins"',
    () => {
      const run = runLintMetaOnRealTree(
        {
          '.github/workflows/security.yml': `${WORKFLOW_HEAD}    runs-on: ubuntu-24.04\n    env:\n      GITLEAKS_VERSION: '8.19.0'\n`,
          'scripts/ci/pre-push.sh': [
            '#!/usr/bin/env bash',
            'GITLEAKS_VERSION="8.18.0"',
            'native="$(gitleaks version)"',
            '[ "$native" = "$GITLEAKS_VERSION" ] || exit 1',
            'gitleaks git .',
            '',
          ].join('\n'),
        },
        'createSecurityScannerVersionParityRule',
      );

      expect(run.stdout).toContain('security-scanner-version-parity');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('pins gitleaks 8.18.0 but CI pins 8.19.0');
      expect(run.violations.join('\n')).not.toContain('no workflow pins');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );
});
