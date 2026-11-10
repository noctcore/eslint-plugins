/**
 * JSON with comments and trailing commas, as `tsconfig.json` and friends are
 * written. A small scanner rather than a regex: a regex that strips `//` also
 * eats the `//` inside a string such as `"https://..."` or `"**\/*"` paths.
 */

/** `text` with comments outside strings removed and trailing commas dropped. */
export function stripJsonc(text: string): string {
  // Twice: the first pass cannot see a trailing comma that a comment follows.
  return stripPass(stripPass(text));
}

function stripPass(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? '';
    const next = text[i + 1];

    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }

    if (char === ',') {
      let ahead = i + 1;
      while (ahead < text.length && /\s/u.test(text[ahead] ?? '')) ahead += 1;
      if (text[ahead] === '}' || text[ahead] === ']') {
        i += 1;
        continue;
      }
    }

    out += char;
    i += 1;
  }
  return out;
}

/** The parsed value of a JSONC document, or `undefined` when it does not parse. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text)) as unknown;
  } catch {
    return undefined;
  }
}
