# `noctcore-security/no-timing-unsafe-compare`

> An HMAC digest or signature must not be compared with `===` / `!==` / `==` / `!=` or `Buffer#equals`; use `crypto.timingSafeEqual`.

## Why

String equality and `Buffer#equals` return at the first byte that differs. When one side is the
signature your server computed and the other is the one a caller sent, how long a rejection takes
says how many leading bytes of the forgery were right. Repeated enough times, that is a
byte-by-byte way to forge a webhook signature or a signed cookie without ever knowing the key:

```ts bad
import { createHmac } from 'node:crypto';

export function verify(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}
```

`crypto.timingSafeEqual` takes the same time whatever the contents. It throws on buffers of
different lengths, so check the length first; the length of an HMAC is not a secret.

```ts good
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

`eslint-plugin-security`'s `detect-possible-timing-attacks` looks for names like `password`,
`token` and `secret`, and reports `if (token === undefined)`, which is why it is usually turned
off. This rule decides by where the value came from, not by what it is called.

## What it flags

A comparison (`===`, `!==`, `==`, `!=`, or `a.equals(b)`) where exactly one side is a secret and
the other is not a static value. A value is a secret only when the code shows its origin:

- `.digest(...)` on a chain that starts at `createHmac(...)` (or `crypto.createHmac(...)`),
  through `.update(...)` calls and `const` bindings in the same file;
- the result of `crypto.subtle.sign(...)`, the Web Crypto signer;
- an expression named in `secretSources`;
- any of those through `Buffer.from(x)`, `new Uint8Array(x)`, `new Buffer(x)`, `x.toString(...)`,
  `x.toLowerCase()`, `x.toUpperCase()`, or a `const` that holds one.

```ts bad
const hmac = createHmac('sha256', secret);
hmac.update(rawBody);
// Buffer#equals stops at the first difference too
if (!hmac.digest().equals(Buffer.from(header, 'hex'))) {
  throw new Error('bad signature');
}
```

```ts good
const hmac = createHmac('sha256', secret);
hmac.update(rawBody);
const expected = hmac.digest();
const given = Buffer.from(header, 'hex');
if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
  throw new Error('bad signature');
}
```

## What it leaves alone

- **`createHash(...)` digests.** An unkeyed hash is not a secret. ETags, cache keys, content
  addresses and integrity checks compare them constantly, and learning a stored SHA-256 byte by
  byte does not reveal what was hashed. Only the keyed `createHmac` (and a Web Crypto signature)
  can be forged, so only those count.
- **A secret against a static value**: `digest === undefined`, `digest !== ''`, `sig == null`.
  There is no caller-supplied input on the other side to measure.
- **A secret against another secret.** Comparing `hmac(k, a)` with `hmac(k, b)` is the double-HMAC
  pattern, a documented defence: the attacker cannot choose the bytes being compared.
- **Lengths.** `expected.length !== given.length` is the guard `timingSafeEqual` needs.
- **Names.** `token === providedToken` is not reported unless the rule can see where `token` came
  from. If it holds a secret the rule cannot derive, name it in `secretSources`.

```ts good
import { createHash } from 'node:crypto';

// an ETag is a hash of public content, not a secret
export function isFresh(body: string, ifNoneMatch: string): boolean {
  return createHash('sha256').update(body).digest('hex') === ifNoneMatch;
}
```

## What it does not check

`timingSafeEqual(a, b)` without a length guard throws a `RangeError` when the lengths differ. The
rule does not report that. Equal lengths often hold by construction, when both sides are digests
of the same algorithm or the header was validated to a fixed length before it got here, and the
syntax cannot tell those apart from the unguarded case. A rule that guessed would fire on correct
code.

## Options

```ts prose reason="the options type, not a lint example"
type Options = {
  /**
   * Expressions (source text) that hold a secret the rule cannot derive on its own:
   * `process.env.API_KEY`, `config.webhookSecret`. An entry ending in `()` matches
   * any call to that callee, whatever its arguments: `getApiKey()`.
   * Default: [].
   */
  secretSources?: string[];
};
```

```ts bad options={"secretSources":["process.env.ADMIN_API_KEY"]}
export function isAdmin(headers: Headers): boolean {
  return headers.get('x-api-key') === process.env.ADMIN_API_KEY;
}
```

```ts good options={"secretSources":["process.env.ADMIN_API_KEY"]}
import { timingSafeEqual } from 'node:crypto';

export function isAdmin(headers: Headers): boolean {
  const given = Buffer.from(headers.get('x-api-key') ?? '');
  const expected = Buffer.from(process.env.ADMIN_API_KEY ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## When not to use it

The rule is in `recommended`. It only fires where the code itself shows a keyed digest or a
signature being compared to a runtime value, so there is rarely a reason to turn it off.
