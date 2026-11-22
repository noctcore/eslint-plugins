import { describe, expect, test } from 'bun:test';

import { createRustModuleShapeRule, manifestOffenses } from '../../src/rules/rust-module-shape';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { createFixture, runSync } from '../test-utils/diskFixture';

const RULE_ID = 'rust-module-shape';

function run(files: Record<string, string>, options = {}) {
  return createRustModuleShapeRule(options).run(createFakeCtx({ files }));
}

function functions(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `pub fn f${String(index)}() {}`).join('\n')}\n`;
}

describe('rust-module-shape', () => {
  test('reports a mod.rs that implements, at the first item, listing every item', () => {
    const text = '//! The store.\npub mod task;\npub use task::Task;\n\npub fn open() {}\n\nstruct Cache;\n';
    const violations = run({ 'src/store/mod.rs': text });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/store/mod.rs');
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(5);
    expect(violations[0]?.message ?? '').toMatch(/^line 5: mod\.rs is a manifest but holds 2 top-level item/u);
    expect(violations[0]?.message ?? '').toContain('fn@5, struct@7');
  });

  test('accepts a manifest of mod and use declarations, attributes and docs', () => {
    const text = [
      '//! Manifest.',
      '#[cfg(feature = "x")]',
      'pub mod a;',
      'pub(crate) mod b;',
      'pub use a::{One, Two as Second};',
      'pub use b::*;',
      '/// fn in a doc comment is prose',
      '/* struct in a block comment */',
      '',
    ].join('\n');

    expect(run({ 'src/store/mod.rs': text })).toEqual([]);
  });

  test('does not read items inside a test module, an inline module body, or a string', () => {
    const text = [
      'pub mod a;',
      'mod inline {',
      '    pub fn nested() {}',
      '}',
      'pub use a::NAME;',
      '#[cfg(test)]',
      'mod tests {',
      '    fn helper() {}',
      '}',
      '',
    ].join('\n');

    expect(run({ 'src/store/mod.rs': text })).toEqual([]);
    expect(manifestOffenses('pub mod a;\n#[doc = "fn x() {}"]\npub mod b;\n')).toEqual([]);
  });

  test('sees qualified items: pub(crate), const fn, async, unsafe, extern, macro_rules!', () => {
    const text = [
      'pub(crate) const fn a() {}',
      'pub async fn b() {}',
      'unsafe impl Send for X {}',
      'extern "C" fn c() {}',
      'macro_rules! m { () => {} }',
      'pub static S: u8 = 0;',
      'pub type Alias = u8;',
      '',
    ].join('\n');

    expect(manifestOffenses(text).map((offense) => offense.keyword)).toEqual([
      'fn',
      'fn',
      'impl',
      'fn',
      'macro_rules!',
      'static',
      'type',
    ]);
  });

  test('manifestItems narrows the keywords', () => {
    const text = 'pub mod a;\npub type Alias = a::Thing;\npub const N: u8 = 1;\n';

    expect(run({ 'src/x/mod.rs': text })).toHaveLength(1);
    expect(run({ 'src/x/mod.rs': text }, { manifestItems: ['fn', 'struct'] })).toEqual([]);
  });

  test('only the manifest file is checked as a manifest', () => {
    expect(run({ 'src/store/task.rs': 'pub fn open() {}\n', 'src/lib.rs': 'pub fn run() {}\n' })).toEqual([]);
    expect(run({ 'src/store/index.rs': 'pub fn open() {}\n' }, { manifestFile: 'index.rs' })).toHaveLength(1);
  });

  test('reports a file over the code-line cap, and not one at the cap', () => {
    const violations = run({ 'src/big.rs': functions(401), 'src/ok.rs': functions(400) });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/big.rs');
    expect(violations[0]?.message ?? '').toContain('401 code lines exceeds the 400-line cap');
  });

  test('does not count comments, blanks or test modules toward the cap', () => {
    const tests = `#[cfg(test)]\nmod tests {\n${functions(50)}}\n`;
    const text = `//! doc\n\n${functions(390)}/// doc\n// note\n\n${tests}`;

    expect(run({ 'src/a.rs': text })).toEqual([]);
    expect(run({ 'src/a.rs': text }, { skipTestModules: false })).toHaveLength(1);
  });

  test('maxCodeLines, roots and exclude', () => {
    const files = { 'crates/db/src/a.rs': functions(30), 'tools/gen/src/b.rs': functions(30) };

    expect(run(files, { maxCodeLines: 20 }).map((violation) => violation.file)).toEqual(['crates/db/src/a.rs']);
    expect(run(files, { maxCodeLines: 20, roots: ['tools'] }).map((violation) => violation.file)).toEqual([
      'tools/gen/src/b.rs',
    ]);
    expect(run(files, { maxCodeLines: 20, exclude: ['crates/db/**'] })).toEqual([]);
  });

  test('advisoryCodeLines logs and never reports', () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (line: string) => logged.push(line);
    try {
      expect(run({ 'src/a.rs': functions(360) }, { advisoryCodeLines: 350 })).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(logged.join('\n')).toContain('[advisory] rust-module-shape (src/a.rs): 360 code lines');
  });

  test('has no baseline hook unless baselineDir is set', () => {
    expect(createRustModuleShapeRule().baseline).toBeUndefined();
    const rule = createRustModuleShapeRule({ baselineDir: '.noctcore/baselines', maxCodeLines: 2 });
    const ctx = createFakeCtx({ files: { 'src/a.rs': functions(3), 'src/x/mod.rs': 'pub fn a() {}\n' } });
    expect(rule.baseline?.(ctx)).toEqual({ 'size:src/a.rs': 3, 'manifest:src/x/mod.rs': 1 });
  });

  test('ciCritical defaults to true and id can be changed', () => {
    expect(createRustModuleShapeRule().ciCritical).toBe(true);
    expect(createRustModuleShapeRule({ ciCritical: false }).ciCritical).toBe(false);
    expect(createRustModuleShapeRule({ id: 'engine-module-shape' }).id).toBe('engine-module-shape');
  });

  describe('with a baseline on a real tree', () => {
    const fixture = createFixture({
      'src/legacy.rs': functions(5),
      'src/grown.rs': functions(6),
      'src/fresh.rs': functions(4),
      'src/store/mod.rs': 'pub fn a() {}\n',
      'ci/baselines/rust-module-shape.json': JSON.stringify({
        'size:src/legacy.rs': 5,
        'size:src/grown.rs': 5,
        'manifest:src/store/mod.rs': 1,
      }),
    });

    test('grandfathers recorded offenders that did not grow, and reports new or grown ones', () => {
      const original = console.error;
      console.error = () => undefined;
      try {
        const violations = runSync(
          createRustModuleShapeRule({ maxCodeLines: 3, baselineDir: 'ci/baselines' }),
          fixture.context(),
        );
        expect(violations.map((violation) => violation.file).sort()).toEqual(['src/fresh.rs', 'src/grown.rs']);
      } finally {
        console.error = original;
      }
    });
  });

  describe('tightens a stale or over-generous baseline', () => {
    const fixture = createFixture({
      'src/kept.rs': functions(5),
      'src/small.rs': functions(2),
      'src/shrunk.rs': functions(5),
      'src/clean/mod.rs': 'pub mod a;\n',
      'ci/baselines/rust-module-shape.json': JSON.stringify({
        'size:src/kept.rs': 5,
        'size:src/gone.rs': 9,
        'size:src/small.rs': 6,
        'size:src/shrunk.rs': 10,
        'manifest:src/clean/mod.rs': 2,
        weird: 1,
      }),
    });

    test('reports gone, now-clean and shrunk entries, and a key it cannot read', () => {
      const original = console.error;
      console.error = () => undefined;
      try {
        const violations = runSync(
          createRustModuleShapeRule({ maxCodeLines: 3, baselineDir: 'ci/baselines' }),
          fixture.context(),
        );
        const byFile = Object.fromEntries(violations.map((violation) => [violation.file, violation.message]));
        expect(Object.keys(byFile).sort()).toEqual(['src/clean/mod.rs', 'src/gone.rs', 'src/shrunk.rs', 'src/small.rs', 'weird']);
        expect(byFile['src/gone.rs']).toContain('the file no longer exists');
        expect(byFile['src/small.rs']).toContain('is now within the 3-line cap');
        expect(byFile['src/clean/mod.rs']).toContain('no longer holds items');
        expect(byFile['src/shrunk.rs']).toContain('over-generous: frozen at 10 code lines, now 5');
        expect(
          runSync(createRustModuleShapeRule({ maxCodeLines: 3, baselineDir: 'ci/baselines', tightenRatio: 0.4 }), fixture.context()).map(
            (violation) => violation.file,
          ),
        ).not.toContain('src/shrunk.rs');
      } finally {
        console.error = original;
      }
    });
  });
});
