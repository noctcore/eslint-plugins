import { describe, expect, test } from 'bun:test';

import { createSecurityScannerVersionParityRule } from '../../src/rules/security-scanner-version-parity';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createSecurityScannerVersionParityRule();

const WORKFLOW = (version: string): string =>
  `jobs:\n  gitleaks:\n    env:\n      GITLEAKS_VERSION: '${version}'\n      GITLEAKS_SHA256: 'abc'\n`;

const HOOK = (version: string, options: { check?: boolean; imageTag?: string } = {}): string =>
  [
    '#!/usr/bin/env bash',
    `GITLEAKS_VERSION="${version}"`,
    `GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v${options.imageTag ?? version}"`,
    'gitleaks_scan() {',
    ...(options.check === false
      ? []
      : ['  native="$(gitleaks version)"', '  [ "$native" = "$GITLEAKS_VERSION" ] || return 1']),
    '  gitleaks git .',
    '}',
    '',
  ].join('\n');

function violationsFor(workflows: Record<string, string>, hook?: string) {
  const files = {
    ...Object.fromEntries(
      Object.entries(workflows).map(([name, text]) => [`.github/workflows/${name}`, text]),
    ),
    ...(hook === undefined ? {} : { 'scripts/ci/pre-push.sh': hook }),
  };
  return rule.run(createFakeCtx({ files }));
}

describe('security-scanner-version-parity', () => {
  test('passes when CI and the hook agree and the hook checks the native version', () => {
    expect(violationsFor({ 'sec.yml': WORKFLOW('8.30.1') }, HOOK('8.30.1'))).toEqual([]);
  });

  test('reports a hook that pins a different version than CI, naming both', () => {
    const violations = violationsFor(
      { 'sec.yml': WORKFLOW('8.30.1') },
      HOOK('8.29.0', { imageTag: '8.30.1' }),
    );

    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('security-scanner-version-parity');
    expect(violations[0]?.message ?? '').toMatch(/pins gitleaks 8\.29\.0 but CI pins 8\.30\.1/u);
  });

  test('reports a literal image tag that drifted from the declared version', () => {
    const violations = violationsFor(
      { 'sec.yml': WORKFLOW('8.30.1') },
      HOOK('8.30.1', { imageTag: '8.28.0' }),
    );

    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/tagged v8\.28\.0 but CI pins 8\.30\.1/u);
  });

  test('reports a hook that never checks the native gitleaks version at run time', () => {
    const violations = violationsFor(
      { 'sec.yml': WORKFLOW('8.30.1') },
      HOOK('8.30.1', { check: false }),
    );

    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/never runs `gitleaks version`/u);
  });

  test('reports workflows that pin different versions', () => {
    const violations = violationsFor(
      { 'a.yml': WORKFLOW('8.30.1'), 'b.yml': WORKFLOW('8.29.0') },
      HOOK('8.30.1'),
    );

    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/different gitleaks versions/u);
  });

  test('reports a hook that runs gitleaks when no workflow pins a version, and the reverse', () => {
    expect(violationsFor({}, HOOK('8.30.1')).length).toBe(1);
    expect(
      violationsFor({ 'sec.yml': WORKFLOW('8.30.1') }, '#!/usr/bin/env bash\necho hi\n')[0]
        ?.message ?? '',
    ).toMatch(/does not run gitleaks/u);
  });

  test('reports a hook that names no GITLEAKS_VERSION', () => {
    const violations = violationsFor(
      { 'sec.yml': WORKFLOW('8.30.1') },
      '#!/usr/bin/env bash\ngitleaks version\ngitleaks git .\n',
    );

    expect(violations.length).toBe(1);
    expect(violations[0]?.message ?? '').toMatch(/does not declare `GITLEAKS_VERSION/u);
  });

  test('is dormant when neither side mentions gitleaks', () => {
    expect(violationsFor({ 'ci.yml': 'jobs: {}\n' }, '#!/usr/bin/env bash\n')).toEqual([]);
    expect(violationsFor({ 'ci.yml': 'jobs: {}\n' })).toEqual([]);
  });

  test('pins another scanner through the options', () => {
    const trivy = createSecurityScannerVersionParityRule({
      scanner: 'trivy',
      versionVariable: 'TRIVY_VERSION',
      imageVariable: 'TRIVY_IMAGE',
      hookFile: '.husky/pre-push',
    });
    const files = (hookVersion: string): Record<string, string> => ({
      '.github/workflows/sec.yml': "jobs:\n  scan:\n    env:\n      TRIVY_VERSION: '0.58.0'\n",
      '.husky/pre-push': `TRIVY_VERSION="${hookVersion}"\n[ "$(trivy version)" = x ] || exit 1\ntrivy fs .\n`,
    });

    expect(trivy.run(createFakeCtx({ files: files('0.58.0') }))).toEqual([]);
    const v = trivy.run(createFakeCtx({ files: files('0.57.1') }));
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe('.husky/pre-push');
    expect(v[0]?.message ?? '').toMatch(/pins trivy 0\.57\.1 but CI pins 0\.58\.0/u);
    expect(rule.run(createFakeCtx({ files: files('0.57.1') }))).toEqual([]);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createSecurityScannerVersionParityRule().ciCritical).toBe(true);
    expect(createSecurityScannerVersionParityRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
