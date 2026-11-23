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
- `res.set('Location', url)`, `res.header('location', url)`, `res.setHeader('Location', url)`,
  `res.append('Location', url)` and `res.appendHeader('Location', url)`, with the header name in
  any case, also when a binding holds it (`const L = 'Location'`), and through a computed method
  (`res['setHeader'](...)`);
- `res.set({ Location: url })`, `reply.headers({ Location: url })` and
  `res.writeHead(302, { Location: url })`, also with a computed key (`{ [L]: url }`), Node's array
  forms (`['Location', url]` and `[['Location', url]]`), `res.setHeaders(new Map(...))` or
  `new Headers(...)`, and a headers holder built earlier in the file (`const headers = {}`, then
  `headers.Location = url`, `headers.set(...)`, `headers.push(...)` or `Object.assign(headers, ...)`).

Outside Express and Fastify, `Response.redirect(url)` (in the default `redirectCallees`) and the
`headers` of `new Response(body, init)` or `new NextResponse(body, init)` are read the same way.

A sink after calls that return the response is still on the response:
`res.status(302).set('Location', url)`, `reply.code(302).header('Location', url)` and
`res.status(302).redirect(url)` are all read.

```ts bad
export function back(req, res) {
  return res.status(302).set('Location', String(req.query.next)).end();
}
```

```ts bad reports=2
const LOCATION = 'location';

export function back(req, res) {
  res.writeHead(302, [LOCATION, String(req.query.next)]);
}

export function GET(request: Request) {
  return Response.redirect(new URL(request.url).searchParams.get('next') ?? '/');
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
  literal domain of at least two labels, bounded by `^` or a dot: right before the domain comes
  `^`, a literal `\.`, a group whose every alternative ends in `\.`, or (for `origin`) a literal
  `://` (`^(app|docs)\.example\.com$`, `^([a-z]+\.)?example\.com$`,
  `^(?:[a-z0-9-]+\.)*example\.com$`). `^[a-z0-9.-]*example\.com$` accepts `evilexample.com` and
  `^[a-z]+\.com$` accepts any `.com` host, so neither counts. `const` aliases and
  `String(url)` are followed. The host can also be checked inline:
  `if (!HOSTS.includes(new URL(url).hostname)) return;`. A change to the URL object after the check
  (`u.host = x`, `Object.assign(u, ...)`, `Reflect.set(u, ...)`, a write through an alias, or
  handing `u` to a function) cancels it.
- A `hostname` or `host` check counts only for a `Location` header a receiver in `responseObjects`
  writes (`res.redirect`, `res.set(...)`, `reply.redirect` and the rest). Browsers refuse to follow
  such a header to a scheme other than http(s). Any other sink (`redirect()`,
  `NextResponse.redirect`, `Response.redirect`, `new Response(...)`, a configured callee) may hand
  the URL to a client-side router, where `javascript://app.example.com/%0aalert(1)` passes a host
  check and runs. There, only an `origin` check counts: the origin of a URL that is not http(s) is
  `null`.
- A same-site path: the function checked the binding before the redirect (an `if` that exits, or
  an `if` around it) with `startsWith('/')` while refusing `startsWith('//')`, `startsWith('/\\')`
  (or `includes('\\')`) and a tab, a line feed and a carriage return (`includes('\t')`, ...,
  or a one-class regex such as `/[\t\n\r]/`), or with a regex that starts `^\/` followed by a
  character that cannot be `/`, `\`, a tab or a line break (`^\/[a-z0-9]`, `^\/[^\/\\\s]`).
  Browsers read `/\evil.com` and `/<tab>/evil.com` as `//evil.com`, and Node lets a tab through
  in a raw header, so a check that refuses only `//` and `/\` keeps the report. When the value is
  searched bare (`next.includes('\t')`), the `startsWith('/')` check must read the bare value too:
  `String(next).startsWith('/')` with a bare `next.includes(...)` lets an array through.
- A value read from an in-file table of literal destinations: `TABLE[key]`, `TABLE.key` or
  `MAP.get(key)` on a `const` object or `new Map([...])` whose values are all literals, never
  exported or changed (also with a literal fallback, `TABLE[key] ?? '/'`).
- A value checked against a literal allowlist (`if (!TARGETS.has(to)) return`, with `TARGETS` an
  in-file `new Set([...])` or array of literals that never changes), alone or followed by text that
  starts a query or a fragment (`${to}?from=login`).
- A literal origin with no path followed by a value known to start with `/`:
  `'https://app.example.com' + (next.startsWith('/') ? next : '/')`. The literal fixes the host,
  so `//` or `/\` after it only changes the path.
- The path of a URL object compared to a literal origin, with `//` paths refused, and not changed
  after the check: `u.origin === ORIGIN && !u.pathname.startsWith('//')`, then `u.pathname`
  (optionally `+ u.search` / `+ u.hash`). A URL object built with `new URL(...)` in every
  assignment (`try { u = new URL(x, base) } catch { u = new URL(FALLBACK) }`) can also be
  host-pinned through `u.hostname`.

Checks are read where the value is used: a check in `ok ? target : '/'` counts for `target`, a
`const` boolean (`const ok = LOCAL.test(next)`) stands for its test, and a `const` holding the target
(`const target = ok ? next : '/'`) is followed, each branch on its own. A local-path regex may use a
lookahead for the second character (`^\/(?![\/\\])[\x21-\x7e]*$`); the characters after it must
then be a plain class that admits no tab or line break unless the lookahead refuses them.

```ts good
const LOCAL = /^\/(?![\/\\])[\x21-\x7e]*$/;

export function back(req, res) {
  const next = String(req.query.next);
  const ok = LOCAL.test(next);
  res.writeHead(302, { Location: ok ? next : '/' });
}
```

```ts bad
// `/\evil.com` passes this check and leaves the site
export function back(req, res) {
  const next = String(req.query.next);
  if (!next.startsWith('/') || next.startsWith('//')) return res.redirect('/');
  res.redirect(next);
}
```

```ts bad
// `/<tab>/evil.com` passes this check: the browser drops the tab
export function back(req, res) {
  const next = String(req.query.next);
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return res.end();
  res.set('Location', next).sendStatus(302);
}
```

```ts good
export function back(req, res) {
  const next = String(req.query.next);
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\t\n\r]/.test(next)) {
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
| `responseObjects` | `string[]` | `['res', 'response', 'reply']` | Receivers whose header writes (`set`, `header`, `headers`, `setHeader`, `append`, `appendHeader`, `setHeaders`, `writeHead`) are checked for a `Location` header. A `hostname` / `host` check counts only for these receivers; other sinks need an `origin` check. Setting this replaces the defaults. |
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
| `Response.redirect(url[, status])` (Fetch API) | 0 |

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

### Limits

The header name and the headers holder are read in the same file: a name imported from another
module, a receiver under another name (`const r = res`), a destructured method
(`const { setHeader } = res`) or a holder filled by a helper are not seen.

## When not to use it

If your redirects are all to external identity providers built from discovery documents, the rule
will flag each one; list the builder in `trustedOrigins` rather than turning the rule off.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT).
