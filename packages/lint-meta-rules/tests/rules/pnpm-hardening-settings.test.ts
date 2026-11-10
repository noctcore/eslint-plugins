import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

import { createFakeCtx } from '../test-utils/createFakeCtx';
import { createFixture, messages, runSync } from '../test-utils/diskFixture';
import { createPnpmHardeningSettingsRule } from '../../src/rules/pnpm-hardening-settings';

// The release-age exclusion is per repo; these cases exclude one scope, as an author of a package family would.
const pnpmHardeningSettingsRule = createPnpmHardeningSettingsRule({ releaseAgeExclude: ['@noctcore/*'] });

const SETTINGS = [
  'packages:',
  "  - 'apps/*'",
  '',
  'minimumReleaseAge: 10080',
  '',
  'minimumReleaseAgeExclude:',
  "  - '@noctcore/*'",
  '',
  'strictDepBuilds: true',
  'blockExoticSubdeps: true',
  'engineStrict: true',
  'trustPolicy: no-downgrade',
  '',
  'trustPolicyExclude:',
  '  # semver 5.7.2 and 6.3.1 are maintainer backports published after the signed 7.5.x.',
  "  - 'semver@5.7.2 || 6.3.1'",
  '  # The @scope/cli 1.2.3 release lost its provenance; its tarball was compared with 1.2.2.',
  "  - '@scope/cli@1.2.3'",
  '',
].join('\n');

function run(workspace: string, files: Record<string, string> = {}): string[] {
  const fixture = createFixture({ 'pnpm-workspace.yaml': workspace, ...files });
  return messages(runSync(pnpmHardeningSettingsRule, fixture.context()));
}

describe('pnpm-hardening-settings', () => {
  it('passes the hardened settings with reasoned exact exclusions', () => {
    assert.deepEqual(run(SETTINGS), []);
  });

  it('reports each install setting that is off, missing or weakened', () => {
    const found = run(
      SETTINGS.replace('strictDepBuilds: true', 'strictDepBuilds: false')
        .replace('blockExoticSubdeps: true\n', '')
        .replace('engineStrict: true', "engineStrict: 'false'")
        .replace('trustPolicy: no-downgrade', 'trustPolicy: off'),
    );
    assert.equal(found.length, 4);
    assert.match(found[0] ?? '', /`strictDepBuilds` is "false"; it must be "true"/u);
    assert.match(found[1] ?? '', /`blockExoticSubdeps` is not set; it must be "true"/u);
    assert.match(found[2] ?? '', /`engineStrict` is "false"; it must be "true"/u);
    assert.match(found[3] ?? '', /`trustPolicy` is "off"; it must be "no-downgrade"/u);
  });

  it('reports a release-age gate under seven days, or one that is not a number', () => {
    assert.match(
      run(SETTINGS.replace('minimumReleaseAge: 10080', 'minimumReleaseAge: 1440'))[0] ?? '',
      /`minimumReleaseAge` is 1440 minutes; it must be at least 10080/u,
    );
    assert.match(
      run(SETTINGS.replace('minimumReleaseAge: 10080', 'minimumReleaseAge: soon'))[0] ?? '',
      /`minimumReleaseAge` is "soon"/u,
    );
    assert.match(
      run(SETTINGS.replace('minimumReleaseAge: 10080\n', ''))[0] ?? '',
      /`minimumReleaseAge` is not set/u,
    );
  });

  it('reports a release-age exclusion other than exactly @noctcore/*', () => {
    const widened = run(
      SETTINGS.replace("  - '@noctcore/*'\n", "  - '@noctcore/*'\n  - left-pad\n"),
    );
    assert.equal(widened.length, 1);
    assert.match(
      widened[0] ?? '',
      /`minimumReleaseAgeExclude` is \[@noctcore\/\*, left-pad\]; it must be exactly \[@noctcore\/\*\]/u,
    );
    assert.match(
      run(SETTINGS.replace("minimumReleaseAgeExclude:\n  - '@noctcore/*'\n", ''))[0] ?? '',
      /`minimumReleaseAgeExclude` is not set/u,
    );
  });

  it('reports a trust exclusion that is not an exact version', () => {
    const found = run(
      SETTINGS.replace("'@scope/cli@1.2.3'", "'@scope/cli@^1.2.3'").replace(
        "'semver@5.7.2 || 6.3.1'",
        "'semver'",
      ),
    );
    assert.equal(found.length, 2);
    assert.match(found[0] ?? '', /"semver" is not an exact version/u);
    assert.match(found[1] ?? '', /"@scope\/cli@\^1\.2\.3" is not an exact version/u);
  });

  it('reports a trust exclusion whose reason comment is missing or does not name its package and every version', () => {
    const noComment = run(
      SETTINGS.replace(
        '  # The @scope/cli 1.2.3 release lost its provenance; its tarball was compared with 1.2.2.\n',
        '',
      ),
    );
    assert.equal(noComment.length, 1);
    assert.match(
      noComment[0] ?? '',
      /"@scope\/cli@1\.2\.3" has no reason comment that names @scope\/cli and 1\.2\.3/u,
    );

    const halfReason = run(SETTINGS.replace('semver 5.7.2 and 6.3.1 are', 'semver 5.7.2 is'));
    assert.equal(halfReason.length, 1);
    assert.match(
      halfReason[0] ?? '',
      /"semver@5\.7\.2 \|\| 6\.3\.1" has no reason comment that names 6\.3\.1\./u,
    );

    // A longer version is not the one excluded: 5.7.20 does not name 5.7.2.
    const nearMiss = run(SETTINGS.replace('semver 5.7.2 and', 'semver 5.7.20 and'));
    assert.equal(nearMiss.length, 1);
    assert.match(nearMiss[0] ?? '', /names 5\.7\.2\./u);
  });

  it('reports a trust policy waved through by age, and a build policy switched off wholesale', () => {
    const found = run(
      `${SETTINGS}trustPolicyIgnoreAfter: 525600\ndangerouslyAllowAllBuilds: true\n`,
    );
    assert.equal(found.length, 2);
    assert.match(found[0] ?? '', /`trustPolicyIgnoreAfter` is set/u);
    assert.match(found[1] ?? '', /`dangerouslyAllowAllBuilds` is set/u);
  });

  it('reports a hardening setting written in .npmrc or package.json, where it would win or split the source of truth', () => {
    const found = run(SETTINGS, {
      '.npmrc': '# a comment\nengine-strict=false\nregistry=https://registry.npmjs.org/\n',
      'package.json': JSON.stringify({
        name: 'x',
        pnpm: { strictDepBuilds: false, overrides: {} },
      }),
    });
    assert.equal(found.length, 2);
    assert.match(found[0] ?? '', /\.npmrc sets `engine-strict`/u);
    assert.match(found[1] ?? '', /package\.json sets `pnpm\.strictDepBuilds`/u);
  });

  it('reports a hardened setting overridden by a flag or an environment variable in a workflow, a Dockerfile or a package script', () => {
    const found = run(SETTINGS, {
      '.github/workflows/ci.yml':
        'jobs:\n  quality:\n    env:\n      npm_config_strict_dep_builds: false\n    steps:\n      - run: pnpm install --config.trust-policy=off\n',
      'apps/api/Dockerfile':
        'FROM node:22-slim\nRUN PNPM_CONFIG_ENGINE_STRICT=false pnpm install --frozen-lockfile\n',
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        scripts: { setup: 'pnpm install --no-block-exotic-subdeps' },
      }),
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { lint: 'eslint .', fresh: 'pnpm add x --config.minimumReleaseAge=0' },
      }),
    });
    assert.equal(found.length, 5);
    assert.match(
      found[0] ?? '',
      /\.github\/workflows\/ci\.yml overrides `strictDepBuilds` with "npm_config_strict_dep_builds"/u,
    );
    assert.match(
      found[1] ?? '',
      /\.github\/workflows\/ci\.yml overrides `trustPolicy` with "--config\.trust-policy"/u,
    );
    assert.match(
      found[2] ?? '',
      /apps\/api\/Dockerfile overrides `engineStrict` with "PNPM_CONFIG_ENGINE_STRICT"/u,
    );
    assert.match(
      found[3] ?? '',
      /apps\/web\/package\.json script "setup" overrides `blockExoticSubdeps` with "--no-block-exotic-subdeps"/u,
    );
    assert.match(
      found[4] ?? '',
      /package\.json script "fresh" overrides `minimumReleaseAge` with "--config\.minimumReleaseAge"/u,
    );
  });

  it('reports a trust exclusion list it cannot read, and a missing pnpm-workspace.yaml', () => {
    assert.match(
      run(SETTINGS.replace('trustPolicyExclude:\n', "trustPolicyExclude: ['a@1.0.0']\n"))[0] ?? '',
      /`trustPolicyExclude` holds "\['a@1\.0\.0'\]", which this rule cannot read/u,
    );
    const fixture = createFixture();
    fixture.write({ 'pnpm-workspace.yaml': '' });
    const found = messages(runSync(pnpmHardeningSettingsRule, fixture.context()));
    assert.match(found[0] ?? '', /`strictDepBuilds` is not set/u);
  });
});

describe('pnpm-hardening-settings, options', () => {
  it('stays dormant in a repo with no pnpm-workspace.yaml', () => {
    const rule = createPnpmHardeningSettingsRule();
    assert.deepEqual(runSync(rule, createFakeCtx({ files: { 'package.json': '{}' } })), []);
  });

  it('by default lets no package skip the release-age gate', () => {
    const rule = createPnpmHardeningSettingsRule();
    const found = messages(runSync(rule, createFakeCtx({ files: { 'pnpm-workspace.yaml': SETTINGS } })));
    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /`minimumReleaseAgeExclude` is \[@noctcore\/\*\]; it must be exactly \[\]/u);
  });

  it('takes its own required settings and release-age floor', () => {
    const rule = createPnpmHardeningSettingsRule({
      required: { strictDepBuilds: 'true' },
      minimumReleaseAgeMinutes: 1440,
      releaseAgeExclude: ['@noctcore/*'],
    });
    const workspace = SETTINGS.replace('minimumReleaseAge: 10080', 'minimumReleaseAge: 1440').replace('engineStrict: true\n', '');
    assert.deepEqual(messages(runSync(rule, createFakeCtx({ files: { 'pnpm-workspace.yaml': workspace } }))), []);
  });
});
