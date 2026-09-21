import { describe, expect, test } from 'bun:test';

import { createDockerfileBaseImageDigestPinRule } from '../../src/rules/dockerfile-base-image-digest-pin';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createDockerfileBaseImageDigestPinRule();

const DIGEST = `sha256:${'b'.repeat(64)}`;

function violationsFor(files: Record<string, string>) {
  return rule.run(createFakeCtx({ files }));
}

describe('dockerfile-base-image-digest-pin', () => {
  test('reports a tag-only base image, naming the image and the line', () => {
    const violations = violationsFor({
      'apps/api/Dockerfile': 'FROM node:22-slim AS deps\nRUN true\n',
    });

    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('dockerfile-base-image-digest-pin');
    expect(violations[0]?.file).toBe('apps/api/Dockerfile');
    expect(violations[0]?.message ?? '').toMatch(
      /line 1: base image "node:22-slim" is not pinned by digest/u,
    );
  });

  test('reports every unpinned stage and an untagged image', () => {
    const violations = violationsFor({
      'apps/api/Dockerfile': `FROM node:22-slim AS a\nFROM node:22-slim@${DIGEST} AS b\nFROM ubuntu\n`,
    });

    expect(violations.length).toBe(2);
  });

  test('passes a digest-pinned base and skips scratch and earlier stages', () => {
    expect(
      violationsFor({
        'apps/api/Dockerfile': [
          `FROM --platform=linux/amd64 node:22-slim@${DIGEST} AS deps`,
          'FROM deps AS builder',
          'FROM scratch',
          'FROM builder',
          '',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  test('resolves a build-arg base from its default and reports one it cannot resolve', () => {
    expect(
      violationsFor({
        Dockerfile: `ARG BASE=node:22-slim@${DIGEST}\nFROM \${BASE}\n`,
      }),
    ).toEqual([]);

    const unresolved = violationsFor({ Dockerfile: 'FROM ${BASE}\n' });
    expect(unresolved.length).toBe(1);
    expect(unresolved[0]?.message ?? '').toMatch(/base image "\$\{BASE\}"/u);
  });

  test('finds Dockerfile.<name> and <name>.Dockerfile, and ignores other files', () => {
    const violations = violationsFor({
      'docker/Dockerfile.dev': 'FROM node:22\n',
      'docker/api.Dockerfile': 'FROM node:22\n',
      'docker/notes.md': 'FROM node:22\n',
    });

    expect(violations.map((violation) => violation.file)).toEqual([
      'docker/Dockerfile.dev',
      'docker/api.Dockerfile',
    ]);
  });

  test('skips Dockerfiles under node_modules and other skipDirs', () => {
    expect(violationsFor({ 'node_modules/pkg/Dockerfile': 'FROM node:22\n' })).toEqual([]);
    const custom = createDockerfileBaseImageDigestPinRule({ skipDirs: ['vendor'] });
    const ctx = createFakeCtx({
      files: {
        'vendor/Dockerfile': 'FROM node:22\n',
        'node_modules/pkg/Dockerfile': 'FROM node:22\n',
      },
    });
    expect(custom.run(ctx).map((v) => v.file)).toEqual(['node_modules/pkg/Dockerfile']);
  });

  test('honors custom dockerfileGlobs', () => {
    const custom = createDockerfileBaseImageDigestPinRule({
      dockerfileGlobs: ['**/Containerfile'],
    });
    const ctx = createFakeCtx({
      files: { Containerfile: 'FROM node:22\n', Dockerfile: 'FROM node:22\n' },
    });
    expect(custom.run(ctx).map((v) => v.file)).toEqual(['Containerfile']);
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createDockerfileBaseImageDigestPinRule().ciCritical).toBe(true);
    expect(createDockerfileBaseImageDigestPinRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
