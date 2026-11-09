import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCache } from '../src/fileCache';

describe('createFileCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eslint-utils-cache-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses once per modification time and re-reads when it moves', () => {
    const file = path.join(dir, 'schema.txt');
    writeFileSync(file, 'one');
    utimesSync(file, 1_000, 1_000);
    let parses = 0;
    const cache = createFileCache((text) => {
      parses += 1;
      return text.toUpperCase();
    });

    expect(cache.get(file)).toBe('ONE');
    expect(cache.get(file)).toBe('ONE');
    expect(parses).toBe(1);

    writeFileSync(file, 'two');
    utimesSync(file, 2_000, 2_000);
    expect(cache.get(file)).toBe('TWO');
    expect(parses).toBe(2);
  });

  it('returns undefined for a missing file and for a directory', () => {
    const cache = createFileCache((text) => text);
    expect(cache.get(path.join(dir, 'missing.txt'))).toBeUndefined();
    const sub = path.join(dir, 'sub');
    mkdirSync(sub);
    expect(cache.get(sub)).toBeUndefined();
  });

  it('forgets a file that disappears', () => {
    const file = path.join(dir, 'gone.txt');
    writeFileSync(file, 'here');
    const cache = createFileCache((text) => text);
    expect(cache.get(file)).toBe('here');
    rmSync(file);
    expect(cache.get(file)).toBeUndefined();
  });

  it('clear() drops cached entries', () => {
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'a');
    let parses = 0;
    const cache = createFileCache((text) => {
      parses += 1;
      return text;
    });
    cache.get(file);
    cache.clear();
    cache.get(file);
    expect(parses).toBe(2);
  });
});
