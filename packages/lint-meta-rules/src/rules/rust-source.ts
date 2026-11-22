/*
 * Text helpers for the Rust architecture rules. Pure string work: the rules
 * never run cargo, so a lint job with no Rust toolchain can still run them.
 *
 * Every helper keeps the line count of its input, so a rule can scan the
 * cleaned text and still report the line the author sees in the editor.
 */

import { matchesAnyGlob } from './glob-match';
import { stripTrailingSlashes } from './shared';

/** What {@link maskRust} blanks out. */
export interface MaskRustOptions {
  /** Blank the contents of string, raw string and char literals too (the quotes stay). Default `false`. */
  readonly strings?: boolean;
}

/** `text` with every character but a newline replaced by a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/gu, ' ');
}

/** The index just past a raw string that starts at `start` (`r"`, `r#"`, `br##"`), or -1 when none starts there. */
function rawStringEnd(text: string, start: number): number {
  const open = /^b?r(#*)"/u.exec(text.slice(start, start + 260));
  if (open === null) return -1;
  const close = `"${open[1] ?? ''}`;
  const end = text.indexOf(close, start + open[0].length);
  return end === -1 ? text.length : end + close.length;
}

/** The index just past a char literal that starts at `start`, or -1 when the `'` opens a lifetime instead. */
function charLiteralEnd(text: string, start: number): number {
  if (text[start + 1] === '\\') {
    const end = text.indexOf("'", start + 2 + (text[start + 2] === "'" ? 1 : 0));
    return end === -1 ? -1 : end + 1;
  }
  const codePoint = text.codePointAt(start + 1);
  if (codePoint === undefined || text[start + 1] === '\n') return -1;
  const width = codePoint > 0xffff ? 2 : 1;
  return text[start + 1 + width] === "'" ? start + 2 + width : -1;
}

/**
 * Rust source with every comment blanked: `//` line comments (doc comments
 * included) and `/* *\/` block comments, nested as Rust nests them. With
 * `strings: true` the contents of literals are blanked as well, so a scan for
 * `crate::` or an attribute never matches text inside a string. Comment
 * markers inside a literal are left alone either way.
 */
export function maskRust(text: string, options: MaskRustOptions = {}): string {
  const strings = options.strings ?? false;
  let out = '';
  let index = 0;
  const isIdentChar = (char: string | undefined): boolean => char !== undefined && /[\w]/u.test(char);
  while (index < text.length) {
    const char = text[index] ?? '';
    const next = text[index + 1];
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '/' && text[cursor + 1] === '*') {
          depth += 1;
          cursor += 2;
        } else if (text[cursor] === '*' && text[cursor + 1] === '/') {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      out += blank(text.slice(index, cursor));
      index = cursor;
      continue;
    }
    if ((char === 'r' || char === 'b') && !isIdentChar(text[index - 1])) {
      const end = rawStringEnd(text, index);
      if (end !== -1) {
        const literal = text.slice(index, end);
        out += strings ? literal.replace(/^(b?r#*")([\s\S]*)("#*)$/u, (_, a: string, body: string, b: string) => a + blank(body) + b) : literal;
        index = end;
        continue;
      }
    }
    if (char === '"') {
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== '"') cursor += text[cursor] === '\\' ? 2 : 1;
      const end = Math.min(cursor + 1, text.length);
      const body = text.slice(index + 1, end - 1);
      out += strings ? `"${blank(body)}"` : text.slice(index, end);
      index = end;
      continue;
    }
    if (char === "'") {
      const end = charLiteralEnd(text, index);
      if (end !== -1) {
        out += strings ? `'${blank(text.slice(index + 1, end - 1))}'` : text.slice(index, end);
        index = end;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

const TEST_ATTRIBUTE = /^\s*#\[cfg\(test\)\]/u;
const MOD_WITH_BODY = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/u;

/**
 * The line ranges, 0-based and inclusive, of every `#[cfg(test)] mod name { ... }`
 * block, from the attribute to its closing brace. Blank lines and other
 * attributes may sit between the attribute and the `mod` line. A `#[cfg(test)]`
 * on anything else (a `use`, a `fn`) and a `mod name;` declaration are not
 * blocks. Expects text passed through {@link maskRust} with `strings: true`, so
 * braces in comments and literals do not count.
 */
export function testModuleRanges(masked: string): [number, number][] {
  const lines = masked.split('\n');
  const ranges: [number, number][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!TEST_ATTRIBUTE.test(line)) continue;
    let modLine = index;
    if (!MOD_WITH_BODY.test(line.replace(TEST_ATTRIBUTE, ''))) {
      modLine = index + 1;
      while (modLine < lines.length && /^\s*(?:#\[.*)?$/u.test(lines[modLine] ?? '')) modLine += 1;
      if (!MOD_WITH_BODY.test(lines[modLine] ?? '')) continue;
    }
    let depth = 0;
    let opened = false;
    let end = modLine;
    for (; end < lines.length; end += 1) {
      for (const char of lines[end] ?? '') {
        if (char === '{') {
          depth += 1;
          opened = true;
        } else if (char === '}') {
          depth -= 1;
        }
      }
      if (opened && depth <= 0) break;
    }
    end = Math.min(end, lines.length - 1);
    ranges.push([index, end]);
    index = end;
  }
  return ranges;
}

function inRanges(index: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => index >= start && index <= end);
}

/** Rust source ready for a structural scan: comments and literal contents blanked, and test modules too when asked. */
export function rustScanText(text: string, skipTestModules: boolean): string {
  const masked = maskRust(text, { strings: true });
  if (!skipTestModules) return masked;
  const ranges = testModuleRanges(masked);
  return masked
    .split('\n')
    .map((line, index) => (inRanges(index, ranges) ? '' : line))
    .join('\n');
}

/**
 * Code lines of a Rust source: lines that are not blank once comments are
 * removed. A line holding only a comment, a doc comment or part of a block
 * comment is not code; a line of a multi-line string literal is. With
 * `skipTestModules`, the lines of every `#[cfg(test)] mod` block are left out too.
 */
export function countRustCodeLines(text: string, skipTestModules: boolean): number {
  const ranges = skipTestModules ? testModuleRanges(maskRust(text, { strings: true })) : [];
  return maskRust(text)
    .split('\n')
    .filter((line, index) => line.trim() !== '' && !inRanges(index, ranges)).length;
}

/** The 1-based line of the character at `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) if (text[index] === '\n') line += 1;
  return line;
}

/** The `.rs` files under `roots`, minus `exclude` globs, sorted and deduplicated. */
export function rustFiles(
  glob: (pattern: string) => string[],
  roots: readonly string[],
  exclude: readonly string[],
): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    for (const file of glob(`${stripTrailingSlashes(root)}/**/*.rs`)) {
      if (!file.split('/').includes('target') && !matchesAnyGlob(file, exclude)) found.add(file);
    }
  }
  return [...found].sort();
}
