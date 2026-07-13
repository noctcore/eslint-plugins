import { describe, expect, test } from 'bun:test';

import { createFileSizeRatchetRule } from '../../src/rules/file-size-ratchet';
import { countLines } from '../../src/rules/shared';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const ID = 'web-file-size-ratchet';
const BASELINE = `.nightcore/lint-meta/baselines/${ID}.json`;
const rule = createFileSizeRatchetRule({ id: ID, roots: ['apps/web/src'], cap: 5 });

/** A file body with exactly `n` physical lines. */
function lines(n: number): string {
  return Array.from({ length: n }, () => 'x').join('\n');
}

describe('file-size-ratchet', () => {
  test('countLines uses wc -l semantics', () => {
    expect(countLines('a\nb\nc')).toBe(3);
    expect(countLines('a\nb\nc\n')).toBe(3);
    expect(countLines('')).toBe(0);
  });

  test('a new over-cap file is flagged', () => {
    const ctx = createFakeCtx({ files: { 'apps/web/src/big.ts': lines(6) } });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('exceeds the 5-line cap');
  });

  test('an at-or-under-cap file passes', () => {
    const ctx = createFakeCtx({ files: { 'apps/web/src/small.ts': lines(5) } });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('a baselined offender within its frozen count is grandfathered', () => {
    const ctx = createFakeCtx({
      files: { 'apps/web/src/big.ts': lines(6), [BASELINE]: JSON.stringify({ 'apps/web/src/big.ts': 6 }) },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('a baselined offender that GREW past its frozen count is flagged', () => {
    const ctx = createFakeCtx({
      files: { 'apps/web/src/big.ts': lines(7), [BASELINE]: JSON.stringify({ 'apps/web/src/big.ts': 6 }) },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('exceeds');
  });

  test('excludes files matching excludeContains (default .test.)', () => {
    const ctx = createFakeCtx({ files: { 'apps/web/src/x.test.ts': lines(9) } });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('excludes files under an excludePrefixes path', () => {
    const withPrefix = createFileSizeRatchetRule({
      id: ID,
      roots: ['apps/web/src'],
      cap: 5,
      excludePrefixes: ['apps/web/src/lib/generated/'],
    });
    const ctx = createFakeCtx({ files: { 'apps/web/src/lib/generated/big.ts': lines(9) } });
    expect(withPrefix.run(ctx)).toHaveLength(0);
  });

  test('a stale baseline entry (file gone) is flagged', () => {
    const ctx = createFakeCtx({ files: { [BASELINE]: JSON.stringify({ 'apps/web/src/gone.ts': 6 }) } });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('no longer exists');
  });

  test('a stale baseline entry (now within cap) is flagged', () => {
    const ctx = createFakeCtx({
      files: { 'apps/web/src/small.ts': lines(3), [BASELINE]: JSON.stringify({ 'apps/web/src/small.ts': 6 }) },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('within the 5-line cap');
  });

  test('an over-generous baseline entry (shrank far below frozen) is flagged', () => {
    const ctx = createFakeCtx({
      files: { 'apps/web/src/big.ts': lines(6), [BASELINE]: JSON.stringify({ 'apps/web/src/big.ts': 100 }) },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('over-generous');
  });

  test('baseline() snapshots the current offenders', () => {
    const ctx = createFakeCtx({ files: { 'apps/web/src/big.ts': lines(6), 'apps/web/src/ok.ts': lines(4) } });
    expect(rule.baseline?.(ctx)).toEqual({ 'apps/web/src/big.ts': 6 });
  });

  test('is inert with no configured roots', () => {
    const inert = createFileSizeRatchetRule();
    const ctx = createFakeCtx({ files: { 'apps/web/src/big.ts': lines(999) } });
    expect(inert.run(ctx)).toHaveLength(0);
  });
});
