# `noctcore-security/no-user-controlled-redirect`

> A redirect whose target **origin** is not fixed at authoring time is an open redirect. Enabled in
> `recommended`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

```ts bad reports=2
// `?next=https://evil.com` sends the user anywhere
res.redirect(req.query.next);

// the userinfo trick: `returnTo = "@evil.com"` makes the host evil.com
res.redirect(302, `${appUrl}${returnTo}`);
```

```ts good
// literal or same-origin path
res.redirect('/login');
res.redirect(302, `/users/${id}`);
```

```ts good options={"trustedOrigins":["this.shared.appUrl","buildAuthErrorRedirect()"],"sanitizers":["sanitizeReturnTo"],"trustedPaths":["OAUTH_TWO_FACTOR_CHALLENGE_PATH"]}
// trusted origin closed by `/`, or followed by a sanitized path (see options)
res.redirect(302, `${this.shared.appUrl}/dashboard`);
res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`);
```

The second bad example is the one worth the rule. `${appUrl}${returnTo}` looks origin-fixed, and it
is safe exactly as long as some sanitizer upstream keeps `returnTo` a path. If that sanitizer ever
regresses, nothing at the redirect site says so. This rule does.

## What it flags

The URL argument of each configured redirect callee goes through the same fixed-origin analysis as
`no-user-controlled-fetch-url`: author-written text, in-file `const` resolution, `+`, `new URL(input,
base)`. A same-origin relative path passes; a runtime host, a runtime value right after a lone `/`,
or a runtime value right after an origin that no `/`, `?` or `#` has closed is flagged.

The analysis judges the target's origin, not where the value came from, so a URL read from the
database (a stored open redirect) or from the `Host` header counts the same as one read from the
query string.

### `Location` headers

A redirect is also a `Location` header plus a 3xx status. On a receiver named in `responseObjects`
(`res`, `response`, `reply` by default), these are checked like `res.redirect`:

- `res.location(url)` (in the default `redirectCallees`);
- `res.set('Location', url)`, `res.header('location', url)`, `res.setHeader('Location', url)`, with
  the header name in any case;
- `res.set({ Location: url })` and `res.writeHead(302, { Location: url })`.

A sink after calls that return the response is still on the response:
`res.status(302).set('Location', url)`, `reply.code(302).header('Location', url)` and
`res.status(302).redirect(url)` are all read.

```ts bad
export function back(req, res) {
  return res.status(302).set('Location', String(req.query.next)).end();
}
```

## What it does not flag

- A literal URL, or a same-origin relative path even with a runtime segment (`/users/${id}`).
- A `trustedOrigins` match closed by `/`, `?` or `#`, or followed by a sanitizer's result or a
  trusted path; a sanitizer's result on its own.
- Redirect calls not listed in `redirectCallees` (`ctx.redirect` needs configuring), and header
  writes on receivers not in `responseObjects` (a `Headers` object's `headers.set(...)`).
- A host-pinned target: the URL's host was read with `new URL(url).hostname` (or `.host` /
  `.origin`, with no base argument) into a binding, that binding passed an allowlist before the
  redirect (an `if` that exits, or an `if` around it), and the URL was not written after the read.
  The allowlist is `includes` / `has` on in-file literals, `===` against literals, or a regex
  anchored at both ends, without the `m` flag or a `.` wildcard, whose every alternative ends in a
  literal domain (`^(app|docs)\.example\.com$`, `^([a-z]+\.)?example\.com$`). `const` aliases and
  `String(url)` are followed. The host can also be checked inline:
  `if (!HOSTS.includes(new URL(url).hostname)) return;`.
- A same-site path: the function checked the binding before the redirect (an `if` that exits, or
  an `if` around it) with `startsWith('/')` while refusing both `startsWith('//')` and
  `startsWith('/\\')` (or `includes('\\')`), or with a regex that starts `^\/` followed by a
  character that cannot be `/`, `\`, a tab or a line break (`^\/[a-z0-9]`, `^\/[^\/\\\s]`).
  Browsers read `/\evil.com` and `/<tab>/evil.com` as `//evil.com`, so a check that refuses only
  `//` keeps the report.
- A value read from an in-file table of literal destinations: `TABLE[key]`, `TABLE.key` or
  `MAP.get(key)` on a `const` object or `new Map([...])` whose values are all literals, never
  exported or changed (also with a literal fallback, `TABLE[key] ?? '/'`).

```ts bad
// `/\evil.com` passes this check and leaves the site
export function back(req, res) {
  const next = String(req.query.next);
  if (!next.startsWith('/') || next.startsWith('//')) return res.redirect('/');
  res.redirect(next);
}
```

```ts good
export function back(req, res) {
  const next = String(req.query.next);
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return res.redirect('/');
  }
  res.redirect(next);
}
```

```ts bad
// the check only logs, and `/example\.com$/` also matches `evilexample.com`
export function go(req, res) {
  const target = String(req.query.next);
  const host = new URL(target).hostname;
  if (!/example\.com$/.test(host)) console.warn('unexpected host', host);
  res.redirect(target);
}
```

```ts good
// only two hosts get past the check
export function go(req, res) {
  const target = String(req.query.next);
  let host = '';
  try {
    host = new URL(target).hostname;
  } catch {
    return res.status(400).end();
  }
  if (!/^(app|docs)\.example\.com$/.test(host)) return res.status(403).end();
  res.redirect(target);
}
```

When the URL argument is an object literal, the URL is read from its `urlProperty` (default `href`),
and an object without that property is skipped. That is what keeps TanStack Router quiet:
`throw redirect({ to: '/dashboard' })` names a route, while `redirect({ href })` is a real location.

```ts good
// a route, not a location
throw redirect({ to: '/auth/login', search: { redirect: location.href } });
```

```ts bad
// a runtime location
throw redirect({ href: search.next });
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `redirectCallees` | `CalleeSpec[]` | see below | Call shapes that redirect. Setting this replaces the defaults. |
| `responseObjects` | `string[]` | `['res', 'response', 'reply']` | Receivers whose `set` / `header` / `setHeader` / `writeHead` calls are checked for a `Location` header. Setting this replaces the defaults. |
| `trustedOrigins` | `string[]` | `[]` | Expressions (source text) that are a fixed-origin URL. `name()` matches any call to `name`. |
| `sanitizers` | `string[]` | `[]` | Functions whose result is a safe same-origin path. |
| `trustedPaths` | `string[]` | `[]` | Expressions (source text) that hold a safe same-origin path, e.g. an imported constant. |

A `CalleeSpec` is `{ name, object?, urlArgument?, urlProperty? }`: `name` is the method or function
name; `object` the receiver source text, omitted for a bare call; `urlArgument` the index of the URL
argument, or `'last'` (default `0`); `urlProperty` the property to read when the URL argument is an
object literal (default `'href'`).

Default `redirectCallees`:

| Call | URL argument |
| --- | --- |
| `redirect(url)` (Next.js, Remix, React Router) | 0 |
| `NextResponse.redirect(url)` | 0 |
| `reply.redirect(url)` (Fastify v5) | 0 |
| `res.redirect([status,] url)` (Express) | last |
| `response.redirect([status,] url)` (Express) | last |
| `res.location(url)` (Express) | 0 |
| `response.location(url)` (Express) | 0 |

`'last'` covers both Express forms: `res.redirect(url)` and `res.redirect(302, url)`.

### `redirectCallees`

```js
'noctcore-security/no-user-controlled-redirect': ['error', {
  redirectCallees: [
    { object: 'res', name: 'redirect', urlArgument: 'last' },
    { object: 'ctx', name: 'redirect' },                    // Koa
    { object: 'reply', name: 'redirect', urlArgument: 1 },  // Fastify v4: reply.redirect(302, url)
  ],
}],
```

### `trustedOrigins`, `sanitizers`, `trustedPaths`

A worked example for a NestJS OAuth controller that redirects back into the web app:

```js
'noctcore-security/no-user-controlled-redirect': ['error', {
  // `this.shared.appUrl` is config; `buildAuthErrorRedirect(appUrl, code)` returns a URL on it.
  trustedOrigins: ['this.shared.appUrl', 'buildAuthErrorRedirect()'],
  // Returns a validated same-origin path (starts with a single `/`).
  sanitizers: ['sanitizeReturnTo'],
  // Imported path constants the rule cannot read across files.
  trustedPaths: ['OAUTH_TWO_FACTOR_CHALLENGE_PATH'],
}],
```

```ts good options={"trustedOrigins":["this.shared.appUrl","buildAuthErrorRedirect()"],"sanitizers":["sanitizeReturnTo"],"trustedPaths":["OAUTH_TWO_FACTOR_CHALLENGE_PATH"]}
res.redirect(302, `${this.shared.appUrl}${OAUTH_TWO_FACTOR_CHALLENGE_PATH}`);
res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`);
res.redirect(302, buildAuthErrorRedirect(this.shared.appUrl, code));
```

```ts bad options={"trustedOrigins":["this.shared.appUrl","buildAuthErrorRedirect()"],"sanitizers":["sanitizeReturnTo"],"trustedPaths":["OAUTH_TWO_FACTOR_CHALLENGE_PATH"]}
// still flagged: `flow.returnTo` was sanitized somewhere else, which this site cannot see
res.redirect(302, `${this.shared.appUrl}${flow.returnTo}`);
```

Entries match by source text with whitespace ignored. An entry ending in `()` matches any call to
that callee, whatever its arguments. For Next.js middleware, `trustedOrigins: ['request.url']` lets
`NextResponse.redirect(new URL('/login', request.url))` pass.

## When not to use it

If your redirects are all to external identity providers built from discovery documents, the rule
will flag each one; list the builder in `trustedOrigins` rather than turning the rule off.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT).
