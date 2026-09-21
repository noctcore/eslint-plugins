import { describe, expect, test } from 'bun:test';

import {
  composeImages,
  createServiceImageDigestPinRule,
  workflowImages,
} from '../../src/rules/service-image-digest-pin';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function violationsFor(files: Record<string, string>, rule = createServiceImageDigestPinRule()) {
  return rule.run(createFakeCtx({ files }));
}

const WORKFLOW = (image: string): string =>
  `jobs:\n  test:\n    runs-on: ubuntu-24.04\n    services:\n      postgres:\n        image: ${image}\n        ports:\n          - 5432:5432\n`;

describe('service-image-digest-pin', () => {
  test('reports a tag-only workflow service image, naming the image and the line', () => {
    const violations = violationsFor({
      '.github/workflows/ci.yml': WORKFLOW('postgres:17-alpine'),
    });

    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('service-image-digest-pin');
    expect(violations[0]?.message ?? '').toMatch(
      /line 6: image "postgres:17-alpine" is not pinned by digest/u,
    );
  });

  test('reports a floating `latest` and an untagged image', () => {
    const latest = violationsFor({
      '.github/workflows/ci.yml': WORKFLOW('ghcr.io/example/s3rver:latest'),
    });
    const untagged = violationsFor({ '.github/workflows/ci.yml': WORKFLOW('axllent/mailpit') });

    expect(latest.length).toBe(1);
    expect(untagged.length).toBe(1);
  });

  test('passes an image pinned as tag@digest', () => {
    expect(
      violationsFor({ '.github/workflows/ci.yml': WORKFLOW(`postgres:17-alpine@${DIGEST}`) }),
    ).toEqual([]);
  });

  test('checks a job `container:` in both scalar and mapping form', () => {
    expect(workflowImages('jobs:\n  a:\n    container: node:22\n').length).toBe(1);
    expect(
      workflowImages('jobs:\n  a:\n    container:\n      image: node:22\n      options: --x\n')
        .length,
    ).toBe(1);
  });

  test('does not read an `image:` input of an action step as a service image', () => {
    const text =
      'jobs:\n  a:\n    steps:\n      - uses: some/action@v1\n        with:\n          image: foo:latest\n';

    expect(workflowImages(text)).toEqual([]);
  });

  test('reports a compose image with no digest, including one behind an env default', () => {
    const violations = violationsFor({
      'docker-compose.yml':
        'services:\n  db:\n    image: postgres:17-alpine\n  cache:\n    image: ${REDIS_IMAGE:-redis:7}\n',
    });

    expect(violations.length).toBe(2);
    expect(violations[0]?.message ?? '').toMatch(/docker-compose\.yml|line 3/u);
  });

  test('finds compose files anywhere in the repo, not only at the root', () => {
    const violations = violationsFor({
      'observability/docker-compose.obs.yml':
        'services:\n  prom:\n    image: prom/prometheus:v3.3.1\n',
      'docker/runner/compose.yaml': 'services:\n  r:\n    image: ubuntu:24.04\n',
    });

    expect(violations.map((violation) => violation.file)).toEqual([
      'docker/runner/compose.yaml',
      'observability/docker-compose.obs.yml',
    ]);
  });

  test('exempts a compose service that builds locally and tags the result', () => {
    const text =
      'services:\n  api:\n    build:\n      context: .\n    image: app-api:local\n  db:\n    image: postgres:17-alpine\n';

    expect(composeImages(text).map((ref) => ref.image)).toEqual(['postgres:17-alpine']);
  });

  test('exempts nothing by default, and only an exact allowUnpinned ref when configured', () => {
    const otel = 'otel/opentelemetry-collector-contrib';
    const files = (tag: string): Record<string, string> => ({
      'observability/docker-compose.obs.yml': `services:\n  otel:\n    image: ${otel}:${tag}\n`,
    });
    const allowing = createServiceImageDigestPinRule({ allowUnpinned: [`${otel}:0.125.0`] });

    expect(violationsFor(files('0.125.0'))).toHaveLength(1);
    expect(violationsFor(files('0.125.0'), allowing)).toEqual([]);

    const other = violationsFor(files('0.126.0'), allowing);
    expect(other.length).toBe(1);
    expect(other[0]?.message ?? '').toMatch(/0\.126\.0/u);
  });

  test('skips compose files under node_modules and honors custom composeGlobs', () => {
    const vendored = {
      'node_modules/x/docker-compose.yml': 'services:\n  a:\n    image: redis:7\n',
    };
    expect(violationsFor(vendored)).toEqual([]);

    const custom = createServiceImageDigestPinRule({ composeGlobs: ['deploy/*.stack.yml'] });
    const v = violationsFor(
      { 'deploy/prod.stack.yml': 'services:\n  a:\n    image: redis:7\n' },
      custom,
    );
    expect(v.map((x) => x.file)).toEqual(['deploy/prod.stack.yml']);
    expect(v[0]?.line).toBe(3);
  });

  test('passes a fully pinned compose file', () => {
    expect(
      violationsFor({
        'docker-compose.yml': `services:\n  db:\n    image: 'postgres:17-alpine@${DIGEST}' # pinned\nvolumes:\n  x: {}\n`,
      }),
    ).toEqual([]);
  });
});
