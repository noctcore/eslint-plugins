import { describe, expect, test } from 'bun:test';

import { createAgentsDocPresenceRule } from '../../src/rules/agents-doc-presence';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const rule = createAgentsDocPresenceRule();

describe('agents-doc-presence', () => {
  test('flags a missing root doc', () => {
    const ctx = createFakeCtx({ files: {} });
    const v = rule.run(ctx);
    expect(v.some((x) => x.file === 'AGENTS.md')).toBe(true);
  });

  test('flags a missing surface doc', () => {
    const ctx = createFakeCtx({
      files: { 'AGENTS.md': '#', 'apps/web/package.json': '{}' },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.file === 'apps/web/AGENTS.md')).toBe(true);
  });

  test('flags a missing package doc', () => {
    const ctx = createFakeCtx({
      files: { 'AGENTS.md': '#', 'packages/core/package.json': '{}' },
    });
    const v = rule.run(ctx);
    expect(v.some((x) => x.file === 'packages/core/AGENTS.md')).toBe(true);
  });

  test('skips an opted-out package', () => {
    const custom = createAgentsDocPresenceRule({ optOut: ['packages/config'] });
    const ctx = createFakeCtx({
      files: { 'AGENTS.md': '#', 'packages/config/package.json': '{}' },
    });
    expect(custom.run(ctx)).toHaveLength(0);
  });

  test('passes when every required doc is present', () => {
    const ctx = createFakeCtx({
      files: {
        'AGENTS.md': '#',
        'apps/web/package.json': '{}',
        'apps/web/AGENTS.md': '#',
        'packages/core/package.json': '{}',
        'packages/core/AGENTS.md': '#',
      },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('requireAtRoot: false drops the root requirement', () => {
    const custom = createAgentsDocPresenceRule({ requireAtRoot: false });
    expect(custom.run(createFakeCtx({ files: {} }))).toHaveLength(0);
  });

  test('honors a custom doc filename', () => {
    const custom = createAgentsDocPresenceRule({ docFile: 'CONTRIBUTING.md', requireAtRoot: true });
    const v = custom.run(createFakeCtx({ files: {} }));
    expect(v[0]?.file).toBe('CONTRIBUTING.md');
  });
});
