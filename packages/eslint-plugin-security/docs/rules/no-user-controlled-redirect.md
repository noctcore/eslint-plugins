# `noctcore-security/no-user-controlled-redirect`

> A redirect whose target **origin** is not fixed at authoring time is an open redirect. Enabled in
> `recommended`.

Ported from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). The port adds configurable
redirect callees with a URL argument index, so Express `res.redirect(302, url)` is recognised, and
checks for a fixed origin (shared with
[`no-user-controlled-fetch-url`](./no-user-controlled-fetch-url.md)) instead of demanding a literal.

## Why

```ts
// ✗ `?next=https://evil.com` sends the user anywhere
res.redirect(req.query.next);

// ✗ the userinfo trick: `returnTo = "@evil.com"` makes the host evil.com
res.redirect(302, `${appUrl}${returnTo}`);
```

```ts
// ✓ literal or same-origin path
res.redirect('/login');
res.redirect(302, `/users/${id}`);

// ✓ trusted origin closed by `/`, or followed by a sanitized path (see options)
res.redirect(302, `${this.shared.appUrl}/dashboard`);
res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`);
```

The second bad example is the one worth the rule. `${appUrl}${returnTo}` looks origin-fixed, and it
is safe exactly as long as some sanitizer upstream keeps `returnTo` a path. If that sanitizer ever
regresses, nothing at the redirect site says so. This rule does.

## What it checks

The URL argument of each configured redirect callee goes through the same fixed-origin analysis as
`no-user-controlled-fetch-url`: author-written text, in-file `const` resolution, `+`, `new URL(input,
base)`. A same-origin relative path passes; a runtime host, a runtime value right after a lone `/`,
or a runtime value right after an origin that no `/`, `?` or `#` has closed is flagged.

## Options

```ts
type CalleeSpec = {
  name: string;          // method or function name
  object?: string;       // receiver source text; omit for a bare call
  urlArgument?: number | 'last'; // default 0
  urlProperty?: string;  // when the URL argument is an object literal; default 'href'
};

type Options = {
  /** Call shapes that redirect. Setting this replaces the defaults. */
  redirectCallees?: CalleeSpec[];
  trustedOrigins?: string[]; // default []
  sanitizers?: string[];     // default []
  trustedPaths?: string[];   // default []
};
```

Default `redirectCallees`:

| Call | URL argument |
| --- | --- |
| `redirect(url)` (Next.js, Remix, React Router) | 0 |
| `NextResponse.redirect(url)` | 0 |
| `reply.redirect(url)` (Fastify v5) | 0 |
| `res.redirect([status,] url)` (Express) | last |
| `response.redirect([status,] url)` (Express) | last |

`'last'` covers both Express forms: `res.redirect(url)` and `res.redirect(302, url)`.

When the URL argument is an object literal, the URL is read from its `urlProperty` (default `href`),
and an object without that property is skipped. That is what keeps TanStack Router quiet:
`throw redirect({ to: '/dashboard' })` names a route, while `redirect({ href })` is a real location.

```ts
// ✓ a route, not a location
throw redirect({ to: '/auth/login', search: { redirect: location.href } });

// ✗ a runtime location
throw redirect({ href: search.next });
```

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

```ts
// ✓
res.redirect(302, `${this.shared.appUrl}${OAUTH_TWO_FACTOR_CHALLENGE_PATH}`);
res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`);
res.redirect(302, buildAuthErrorRedirect(this.shared.appUrl, code));

// ✗ still flagged: `flow.returnTo` was sanitized somewhere else, which this site cannot see
res.redirect(302, `${this.shared.appUrl}${flow.returnTo}`);
```

Entries match by source text with whitespace ignored. An entry ending in `()` matches any call to
that callee, whatever its arguments. For Next.js middleware, `trustedOrigins: ['request.url']` lets
`NextResponse.redirect(new URL('/login', request.url))` pass.

## When not to use it

If your redirects are all to external identity providers built from discovery documents, the rule
will flag each one; list the builder in `trustedOrigins` rather than turning the rule off.
