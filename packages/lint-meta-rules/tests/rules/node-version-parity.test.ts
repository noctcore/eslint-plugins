import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

import { createFixture, messages, runSync } from '../test-utils/diskFixture';
import { createNodeVersionParityRule } from '../../src/rules/node-version-parity';

const nodeVersionParityRule = createNodeVersionParityRule();

const DIGEST = 'sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9';

const WORKFLOW = [
  'name: ci',
  'on: push',
  'jobs:',
  '  quality:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v6',
  '      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
  '        with:',
  '          node-version-file: .nvmrc',
  '          cache: pnpm',
  '',
].join('\n');

const TREE: Record<string, string> = {
  '.nvmrc': '22.23.2\n',
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=22.22.3' } }),
  '.github/workflows/ci.yml': WORKFLOW,
  'apps/api/Dockerfile': `FROM node:22-slim@${DIGEST} AS deps\nRUN echo\nFROM node:22-slim@${DIGEST} AS runner\n`,
  'docker/github-runner/Dockerfile': 'FROM ubuntu:24.04\nARG NODE_MAJOR=22\n',
};

function run(changes: Record<string, string> = {}): string[] {
  return messages(runSync(nodeVersionParityRule, createFixture({ ...TREE, ...changes }).context()));
}

describe('node-version-parity', () => {
  it('passes when .nvmrc, engines, setup-node and every Docker base agree on the major', () => {
    assert.deepEqual(run(), []);
  });

  it('reports a Docker base image on another major, and one whose tag names no major', () => {
    const found = run({
      'apps/api/Dockerfile': `FROM node:24-slim@${DIGEST} AS deps\nFROM node:lts-slim AS runner\nFROM node@${DIGEST}\n`,
    });
    assert.equal(found.length, 3);
    assert.match(
      found[0] ?? '',
      /apps\/api\/Dockerfile:1 builds FROM node:24-slim@sha256:\S+, Node 24; \.nvmrc says 22/u,
    );
    assert.match(
      found[1] ?? '',
      /apps\/api\/Dockerfile:2 builds FROM node:lts-slim, whose tag names no Node major/u,
    );
    assert.match(
      found[2] ?? '',
      /apps\/api\/Dockerfile:3 builds FROM node@sha256:\S+, whose tag names no Node major/u,
    );
  });

  it('reads a FROM continued on the next line', () => {
    const found = run({
      'apps/api/Dockerfile': `FROM \\\n    node:20-slim@${DIGEST} AS builder\nRUN echo\n`,
    });
    assert.equal(found.length, 1);
    assert.match(
      found[0] ?? '',
      /apps\/api\/Dockerfile:1 builds FROM node:20-slim@\S+, Node 20; \.nvmrc says 22/u,
    );
  });

  it('reports a NODE_MAJOR build argument on another major', () => {
    const found = run({
      'docker/github-runner/Dockerfile': 'FROM ubuntu:24.04\nARG NODE_MAJOR=20\n',
    });
    assert.equal(found.length, 1);
    assert.match(
      found[0] ?? '',
      /docker\/github-runner\/Dockerfile:2 sets NODE_MAJOR=20; \.nvmrc says 22/u,
    );
  });

  it('reports a setup-node step on a literal other major, or with no version at all', () => {
    const literal = run({
      '.github/workflows/ci.yml': WORKFLOW.replace(
        'node-version-file: .nvmrc',
        "node-version: '20'",
      ),
    });
    assert.equal(literal.length, 1);
    assert.match(
      literal[0] ?? '',
      /ci\.yml: setup-node in "the step on line 8" installs Node 20; \.nvmrc says 22/u,
    );

    const none = run({
      '.github/workflows/ci.yml': WORKFLOW.replace('          node-version-file: .nvmrc\n', ''),
    });
    assert.equal(none.length, 1);
    assert.match(none[0] ?? '', /names neither node-version-file: \.nvmrc nor a node-version/u);

    const other = run({
      '.github/workflows/ci.yml': WORKFLOW.replace(
        'node-version-file: .nvmrc',
        'node-version-file: .node-version',
      ),
    });
    assert.match(other[0] ?? '', /reads \.node-version, not \.nvmrc/u);
  });

  it('checks a node-version written beside node-version-file, which setup-node installs instead', () => {
    const found = run({
      '.github/workflows/ci.yml': WORKFLOW.replace(
        'node-version-file: .nvmrc',
        "node-version-file: .nvmrc\n          node-version: '24'",
      ),
    });
    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /installs Node 24; \.nvmrc says 22/u);
  });

  it('reads a node image from any registry, and reports a FROM it cannot resolve', () => {
    // `FROM $BASE` names no node at all, so it may be any image and is left alone.
    const found = run({
      'apps/api/Dockerfile': `FROM mirror.gcr.io/library/node:24-slim@${DIGEST}\nFROM \${NODE_IMAGE} AS runner\nFROM node:\${NODE_VERSION}-slim\nFROM $BASE\nFROM deps AS final\n`,
    });
    assert.equal(found.length, 3);
    assert.match(
      found[0] ?? '',
      /apps\/api\/Dockerfile:1 builds FROM mirror\.gcr\.io\/library\/node:24-slim@\S+, Node 24/u,
    );
    assert.match(
      found[1] ?? '',
      /apps\/api\/Dockerfile:2 builds FROM \$\{NODE_IMAGE\}, which this rule cannot resolve/u,
    );
    assert.match(
      found[2] ?? '',
      /apps\/api\/Dockerfile:3 builds FROM node:\$\{NODE_VERSION\}-slim, which this rule cannot resolve/u,
    );
  });

  it('passes a setup-node step that pins a literal version on the same major', () => {
    assert.deepEqual(
      run({
        '.github/workflows/ci.yml': WORKFLOW.replace(
          'node-version-file: .nvmrc',
          'node-version: 22.23.2',
        ),
      }),
      [],
    );
  });

  it('reports an engines floor on another major, and an .nvmrc below the floor', () => {
    const major = run({
      'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20.19.0' } }),
    });
    assert.equal(major.length, 1);
    assert.match(major[0] ?? '', /engines\.node ">=20\.19\.0" starts at Node 20; \.nvmrc says 22/u);

    const below = run({ '.nvmrc': '22.20.0\n' });
    assert.equal(below.length, 1);
    assert.match(below[0] ?? '', /\.nvmrc 22\.20\.0 is below the engines\.node floor 22\.22\.3/u);
  });

  it('reports what it cannot read instead of passing it', () => {
    assert.match(run({ '.nvmrc': 'lts/*\n' })[0] ?? '', /\.nvmrc holds "lts\/\*"/u);
    assert.match(
      run({ 'package.json': JSON.stringify({ name: 'x' }) })[0] ?? '',
      /package\.json has no engines\.node/u,
    );
    assert.match(
      run({ 'package.json': JSON.stringify({ name: 'x', engines: { node: '22 || 24' } }) })[0] ??
        '',
      /engines\.node "22 \|\| 24" is not a single >= floor/u,
    );
  });

  it('accepts an .nvmrc with a v prefix', () => {
    assert.deepEqual(run({ '.nvmrc': 'v22.23.2\n' }), []);
  });
});

describe('node-version-parity, options', () => {
  it('stays dormant without a version file', () => {
    assert.deepEqual(messages(runSync(nodeVersionParityRule, createFixture({ 'package.json': '{}' }).context())), []);
  });

  it('leaves a setup-node version taken from a matrix alone', () => {
    const matrix = WORKFLOW.replace('node-version-file: .nvmrc', 'node-version: ${{ matrix.node }}');
    assert.deepEqual(run({ '.github/workflows/ci.yml': matrix }), []);
  });

  it('compares with another version file, and can skip engines', () => {
    const rule = createNodeVersionParityRule({ versionFile: '.node-version', checkEngines: false });
    const fixture = createFixture({
      ...TREE,
      '.node-version': '24\n',
      'package.json': JSON.stringify({ name: 'x' }),
      '.github/workflows/ci.yml': WORKFLOW.replace('node-version-file: .nvmrc', 'node-version-file: .node-version'),
    });
    const found = messages(runSync(rule, fixture.context()));
    // The two Docker bases on 22 and the NODE_MAJOR=22 argument disagree with 24; engines is not read.
    assert.equal(found.length, 3);
    assert.ok(found.every((message) => message.includes('.node-version says 24')));
  });
});
