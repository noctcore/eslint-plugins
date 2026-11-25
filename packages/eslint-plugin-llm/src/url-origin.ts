/*
 * Copied from `@noctcore/eslint-plugin-security` (`src/url-origin.ts`,
 * `prefixPinsOrigin`), which ported it from tsforge (MIT License, Copyright (c)
 * 2026 Aleksandar Grbic), boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839.
 * Each package carries only the helpers it needs so it survives being
 * published on its own; keep this copy in step with that one.
 */

/**
 * Schemes that leave the page's origin, reach the file system, run script or
 * launch an operating system protocol handler when a request is sent to them.
 * A relative prefix that can still grow into one of them (`h`, `dat`,
 * `ms-`) does not pin the origin.
 */
const ORIGIN_MOVING_SCHEMES: readonly string[] = [
  'http',
  'https',
  'ws',
  'wss',
  'ftp',
  'ftps',
  'sftp',
  'file',
  'data',
  'blob',
  'filesystem',
  'javascript',
  'vbscript',
  'livescript',
  'view-source',
  'jar',
  'intent',
  'gopher',
  'ldap',
  'ldaps',
  'dict',
  'tftp',
  'telnet',
  'smb',
  // Protocol handlers the operating system launches from a link or redirect.
  'ms-msdt',
  'ms-officecmd',
  'ms-word',
  'ms-excel',
  'ms-powerpoint',
  'ms-visio',
  'ms-access',
  'ms-appinstaller',
  'ms-settings',
  'ms-cxh',
  'ms-cxh-full',
  'ms-its',
  'ms-help',
  'search-ms',
  'search',
  'mhtml',
  'mk',
  'hcp',
  'itms-services',
  'itms-apps',
  'vscode',
  'vscode-insiders',
];

/**
 * True when relative text made only of scheme characters can still become one
 * of {@link ORIGIN_MOVING_SCHEMES} once the runtime part after it supplies the
 * rest and a `:` (`h` then `ttps://evil.com`).
 */
function canStartOriginMovingScheme(prefix: string): boolean {
  const lower = prefix.toLowerCase();
  return (
    /^[a-z][a-z0-9+.-]*$/u.test(lower) &&
    ORIGIN_MOVING_SCHEMES.some((scheme) => scheme.startsWith(lower))
  );
}

/**
 * Whether author-written text before the first runtime part fully determines
 * the origin. `https://api.example.com/q?${x}` does; `https://${x}`,
 * `https://api.example.com${x}` (the userinfo trick: `x = "@evil.com"`), a
 * lone `/${x}` (`x = "/evil.com"` makes it protocol-relative), an empty or
 * blank prefix and `h${x}` (`x = "ttps://evil.com"`) do not.
 */
export function prefixPinsOrigin(rawPrefix: string): boolean {
  // Analyse the prefix the way the browser (WHATWG URL) will: leading spaces
  // and control characters are dropped, a tab or line break is dropped from
  // anywhere (`/<tab>` is a lone `/`), and `\` reads as `/` in special
  // schemes, so `/\evil.com` is protocol-relative.
  const prefix = rawPrefix
    .replace(/^[\u0000- ]+/u, '')
    .replace(/[\t\n\r]/gu, '')
    .replace(/\\/gu, '/');

  const scheme = /^[a-z][a-z0-9+.-]*:\/\/+/iu.exec(prefix);
  if (scheme === null && /^[a-z][a-z0-9+.-]*:/iu.test(prefix)) {
    // `https:${x}`: a scheme with no `//` yet, so `x` can supply `//evil.com`.
    return false;
  }
  // Every `/` after `https:` or a leading `//` still opens the authority
  // (`https:///` then `evil.com` goes to evil.com), so the host starts after them.
  const leadingSlashes = /^\/\/+/u.exec(prefix);
  const authorityStart =
    scheme === null ? (leadingSlashes === null ? -1 : leadingSlashes[0].length) : scheme[0].length;

  if (authorityStart === -1) {
    // Relative URL. Safe, except a lone `/` (the runtime part can begin with
    // `/` and turn it into a protocol-relative `//evil.com`) or nothing left
    // once the parser drops what it drops (`' '` then the whole URL), or text
    // the runtime part can finish into a scheme that moves the origin.
    return prefix !== '/' && prefix !== '' && !canStartOriginMovingScheme(prefix);
  }

  // Absolute or protocol-relative: the authority must END inside the literal
  // text, otherwise the interpolation can extend or hijack the host.
  return /[/?#]/u.test(prefix.slice(authorityStart));
}
