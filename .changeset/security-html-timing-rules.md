---
'@noctcore/eslint-plugin-security': minor
---

Two new rules: `no-timing-unsafe-compare`, in `recommended` at `error`, and `require-sanitized-html`,
shipped off and left out of `recommended`.

`no-timing-unsafe-compare` reports `===`, `!==`, `==`, `!=` and `Buffer#equals` when exactly one
side is a secret and the other is a runtime value. A secret is decided by provenance, not by name:
`.digest()` on a `createHmac(...)` chain (through `.update()` calls and `const` bindings), the
result of `crypto.subtle.sign(...)`, or an expression listed in the new `secretSources` option,
also when re-encoded through `Buffer.from`, `new Uint8Array` or `.toString()`. It leaves alone
unkeyed `createHash` digests (ETags, cache keys), comparisons against a literal, `undefined` or
`null`, two secrets compared with each other (the double-HMAC defence) and length guards. It does
not check `timingSafeEqual` for a missing length guard, since equal lengths often hold by
construction and the syntax cannot tell.

`require-sanitized-html` reports HTML reaching JSX `dangerouslySetInnerHTML`, `innerHTML`,
`outerHTML` or `insertAdjacentHTML` unless the rule can see it is static markup, a same-file
`const` bound to static markup, or the result of a sanitizer (`sanitizers`, default
`DOMPurify.sanitize`, `sanitize`, `sanitizeHtml`, `xss`, `filterXSS`). It is opt-in because real
code has trusted HTML no syntactic rule can prove safe, such as a syntax highlighter's output;
name those producers in `trustedSources`.

A project that spreads `recommended` will see new errors wherever an HMAC digest or Web Crypto
signature is compared with `===` or `Buffer#equals` instead of `crypto.timingSafeEqual`.
`require-sanitized-html` changes nothing until you enable it.
