import { describe, expect, test } from 'bun:test';

import { countRustCodeLines, lineLocator, maskRust, rustScanText, testModuleRanges } from '../../src/rules/rust-source';

describe('maskRust', () => {
  test('blanks line, doc and nested block comments and keeps the line count', () => {
    const text = 'let a = 1; // trailing\n/// doc\n/* outer /* inner */ still outer */ let b = 2;\n//! inner doc\n';
    const masked = maskRust(text);

    expect(masked.split('\n')).toHaveLength(text.split('\n').length);
    expect(masked).toContain('let a = 1;');
    expect(masked).toContain('let b = 2;');
    expect(masked).not.toContain('trailing');
    expect(masked).not.toContain('doc');
    expect(masked).not.toContain('outer');
  });

  test('leaves comment markers inside strings alone, and blanks string contents only when asked', () => {
    const text = 'let url = "https://example.com"; // gone\nlet raw = r#"a "// b"#;\n';

    expect(maskRust(text)).toContain('"https://example.com"');
    expect(maskRust(text)).toContain('r#"a "// b"#');
    expect(maskRust(text)).not.toContain('gone');
    const strings = maskRust(text, { strings: true });
    expect(strings).not.toContain('example');
    expect(strings).toContain('let raw = r#"');
  });

  test('tells char literals from lifetimes', () => {
    const text = "fn f<'a>(x: &'a str) -> char { let q = '\"'; let s = '\\''; 'x' }\n";
    const masked = maskRust(text, { strings: true });

    expect(masked).toContain("fn f<'a>(x: &'a str)");
    expect(masked).toContain('{ let q =');
    expect(masked.split('\n')).toHaveLength(2);
  });

  test('reads raw C strings (cr"...") like raw byte strings', () => {
    const text = 'let a = cr#"crate::api // "#; let b = c"crate::db"; use crate::store;\n';
    const masked = maskRust(text, { strings: true });

    expect(masked).not.toContain('crate::api');
    expect(masked).not.toContain('crate::db');
    expect(masked).toContain('use crate::store;');
    expect(masked).toHaveLength(text.length);
  });

  test('an escape quote far from its backslash is not a char literal, and stays linear', () => {
    expect(maskRust("let a = '\\u{10FFFF}'; // c", { strings: true })).toBe("let a = '          ';     ");
    const hostile = "'\\".repeat(30_000);
    const start = performance.now();
    maskRust(hostile, { strings: true });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test('a string that holds an escaped quote ends at the real quote', () => {
    const masked = maskRust('let s = "a \\" // not a comment"; let t = 1;', { strings: true });

    expect(masked).toContain('let t = 1;');
  });
});

describe('test modules', () => {
  test('finds a #[cfg(test)] mod block, with attributes and blanks before the mod line, and on the same line', () => {
    const text = [
      'pub fn real() {}',
      '#[cfg(test)]',
      '',
      '#[allow(unused)]',
      'mod tests {',
      '    fn helper() { let x = "}"; }',
      '}',
      '#[cfg(test)] mod more { fn a() {} }',
      'pub fn after() {}',
    ].join('\n');
    const ranges = testModuleRanges(maskRust(text, { strings: true }));

    expect(ranges).toEqual([
      [1, 6],
      [7, 7],
    ]);
    const scan = rustScanText(text, true);
    expect(scan).toContain('pub fn real');
    expect(scan).toContain('pub fn after');
    expect(scan).not.toContain('helper');
  });

  test('does not treat #[cfg(test)] on a use or fn, or a mod declaration, as a block', () => {
    const text = '#[cfg(test)]\nuse std::fmt;\n#[cfg(test)]\nmod tests;\n#[cfg(test)]\nfn only_in_tests() {}\n';

    expect(testModuleRanges(maskRust(text, { strings: true }))).toEqual([]);
  });
});

describe('countRustCodeLines', () => {
  test('counts code, not blanks, comments or test modules', () => {
    const text = [
      '//! module doc',
      '',
      'pub fn a() {',
      '    /* block',
      '       comment */',
      '    let s = "multi',
      'line";',
      '}',
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn t() {}',
      '}',
    ].join('\n');

    expect(countRustCodeLines(text, true)).toBe(4);
    expect(countRustCodeLines(text, false)).toBe(9);
  });
});

describe('lineLocator', () => {
  test('maps offsets to 1-based lines', () => {
    const text = 'a\nbc\n\nd';
    const lineOf = lineLocator(text);

    expect([0, 1, 2, 4, 5, 6, 7].map(lineOf)).toEqual([1, 1, 2, 2, 3, 4, 4]);
    expect(lineLocator('')(0)).toBe(1);
  });
});
