/*
 * Copied from `@noctcore/eslint-plugin-security` (`src/url-origin.ts`,
 * `prefixPinsOrigin`), which ported it from tsforge (MIT License, Copyright (c)
 * 2026 Aleksandar Grbic), boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839.
 * Each package carries only the helpers it needs so it survives being
 * published on its own.
 */

/**
 * Whether author-written text before the first runtime part fully determines
 * the origin. `https://api.example.com/q?${x}` does; `https://${x}`,
 * `https://api.example.com${x}` (the userinfo trick: `x = "@evil.com"`) and a
 * lone `/${x}` (`x = "/evil.com"` makes it protocol-relative) do not.
 */
export function prefixPinsOrigin(rawPrefix: string): boolean {
  // Browsers (WHATWG URL) read `\` as `/` in special schemes, so `/\evil.com`
  // is protocol-relative. Analyse the prefix the way the browser will.
  const prefix = rawPrefix.replace(/\\/gu, '/');

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(prefix);
  if (scheme === null && /^[a-z][a-z0-9+.-]*:/iu.test(prefix)) {
    // `https:${x}`: a scheme with no `//` yet, so `x` can supply `//evil.com`.
    return false;
  }
  const authorityStart = scheme === null ? (prefix.startsWith('//') ? 2 : -1) : scheme[0].length;

  if (authorityStart === -1) {
    // Relative URL. Safe, except a lone `/`: the runtime part can begin with
    // `/` and turn it into a protocol-relative `//evil.com`.
    return prefix !== '/';
  }

  // Absolute or protocol-relative: the authority must END inside the literal
  // text, otherwise the interpolation can extend or hijack the host.
  return /[/?#]/u.test(prefix.slice(authorityStart));
}
