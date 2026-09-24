# `noctcore-security/no-user-controlled-fetch-url`

> An HTTP request whose **origin** is not fixed at authoring time is a server-side request forgery
> (SSRF) sink. Enabled in `recommended`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

SSRF is control of the **host**, not the path. `fetch(`/api/todos/${id}`)` can only ever reach the
current origin however hostile `id` is, so the rule does not demand a plain literal. What it demands
is that the author wrote the origin, and closed it, before any runtime value appears.

```ts bad reports=3
// the whole URL is runtime
await fetch(url);

// runtime value in the host position
await fetch(`https://${tenant}.example.com/api`);

// the userinfo trick: `path = "@evil.com/x"` resolves to host evil.com,
//   because everything before `@` in the authority is userinfo
await fetch(`https://api.example.com${path}`);
```

```ts good
// relative, same origin
await fetch(`/api/todos/${id}`);

// authority closed by `/` before the first `${...}`
await fetch(`https://api.example.com/users/${id}`);

// a `const` bound to a literal is resolved before reporting
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
```

## What it flags

The URL argument is flattened into author-written text and runtime parts: template quasis, `+`
operands, `new URL(input, base)`, `url.toString()` / `url.href`, and `const` bindings declared in the
same file (followed transitively). `let`, parameters, imports and anything computed are runtime. Then:

| Shape | Verdict |
| --- | --- |
| all text | ok |
| relative text first (`/api/`, `api/`) | ok |
| `/` alone, then a runtime part | flag: `p = "/evil.com"` makes `//evil.com` |
| `scheme://host` or `//host` first, closed by `/`, `?` or `#` | ok |
| `scheme://host` first, not closed | flag: userinfo trick |
| a `trustedOrigins` match first, then text containing `/`, `?`, `#`, or a sanitizer / trusted path | ok |
| a `trustedOrigins` match first, then a runtime part | flag: userinfo trick |
| a runtime part first | flag |

A backslash is read as `/`, the way browsers parse `http(s)` URLs, so `/\evil.com` is caught as
protocol-relative.

## What it does not flag

- Relative URLs (`/api/todos/${id}`): a runtime part can only move the path.
- An absolute URL whose authority is closed by `/`, `?` or `#` before the first runtime part
  (`https://api.example.com/users/${id}`, `https://api.example.com?q=${q}`).
- A `const` bound to a literal URL, followed through templates, `+`, `new URL(relative, base)`,
  `.toString()` and `.href`.
- A `trustedOrigins` match followed by `/`, `?`, `#`, a sanitizer or a trusted path.
- Calls to an HTTP client not listed in `fetchCallees`: a custom client is out of scope until you add it.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchCallees` | `CalleeSpec[]` | `fetch`, `axios.{get,post,put,patch,delete,head,options}` | Call shapes that issue a request. Setting this replaces the defaults. |
| `trustedOrigins` | `string[]` | `[]` | Expressions (source text) that are a fixed-origin URL. `name()` matches any call to `name`. |
| `sanitizers` | `string[]` | `[]` | Functions whose result is a safe same-origin path. |
| `trustedPaths` | `string[]` | `[]` | Expressions (source text) that hold a safe same-origin path, e.g. an imported constant. |

A `CalleeSpec` is `{ name, object?, urlArgument?, urlProperty? }`: `name` is the function or method
name; `object` the receiver source text (`axios`, `this.http`), omitted for a bare call like
`fetch(...)`; `urlArgument` the index of the URL argument, or `'last'` (default `0`); `urlProperty`
the property holding the URL when that argument is an object literal (default `'href'`).

### `fetchCallees`

Cover your own HTTP client. The list replaces the defaults, so repeat `fetch` if you still want it:

```js
'noctcore-security/no-user-controlled-fetch-url': ['error', {
  fetchCallees: [
    { name: 'fetch' },
    { object: 'this.http', name: 'get' },
    { object: 'ky', name: 'post' },
    { object: 'client', name: 'request', urlArgument: 1 }, // client.request('GET', url)
  ],
}],
```

### `trustedOrigins`, `trustedPaths`, `sanitizers`

A base URL that comes from config is runtime to a syntactic rule. Name it once:

```js
'noctcore-security/no-user-controlled-fetch-url': ['error', {
  trustedOrigins: ['getApiBaseUrl()', 'process.env.API_URL'],
  trustedPaths: ['CSRF_TOKEN_PATH'],
  sanitizers: ['toSafePath'],
}],
```

```ts good options={"trustedOrigins":["getApiBaseUrl()","process.env.API_URL"],"trustedPaths":["CSRF_TOKEN_PATH"],"sanitizers":["toSafePath"]}
// with the options above
await fetch(`${getApiBaseUrl()}/todos/${id}`);
await fetch(getApiBaseUrl() + CSRF_TOKEN_PATH); // imported constant, declared trusted
await fetch(`${process.env.API_URL}${toSafePath(input)}`);
```

```ts bad options={"trustedOrigins":["getApiBaseUrl()","process.env.API_URL"],"trustedPaths":["CSRF_TOKEN_PATH"],"sanitizers":["toSafePath"]}
// still flagged: nothing closes the authority after the trusted origin
await fetch(`${getApiBaseUrl()}${input}`);
```

A trusted origin does **not** make whatever follows it safe. The userinfo trick works just as well
against `${getApiBaseUrl()}${input}` as against a literal host; only a `/`, `?`, `#`, a sanitizer or a
trusted path closes the authority.

## When not to use it

In code where every outbound URL is deliberately runtime (a proxy, a webhook dispatcher, a crawler),
this rule is the wrong tool: validate against an allowlist at the call site and turn the rule off for
that directory.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT).
