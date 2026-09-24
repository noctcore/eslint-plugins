# `noctcore-security/no-user-controlled-fetch-url`

> An HTTP request whose **origin** is not fixed at authoring time is a server-side request forgery
> (SSRF) sink. Enabled in `recommended`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

Ported from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT), with configurable callees,
in-file `const` resolution and a trusted-origin vocabulary added.

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

## What it checks

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

## Options

```ts prose reason="the options type, not a lint example"
type CalleeSpec = {
  /** Function or method name. */
  name: string;
  /** Receiver source text (`axios`, `this.http`). Omit for a bare call like `fetch(...)`. */
  object?: string;
  /** Index of the URL argument, or 'last'. Default 0. */
  urlArgument?: number | 'last';
  /** When that argument is an object literal, the property holding the URL. Default 'href'. */
  urlProperty?: string;
};

type Options = {
  /** Call shapes that issue a request. Setting this replaces the defaults. */
  fetchCallees?: CalleeSpec[]; // default: fetch, axios.{get,post,put,patch,delete,head,options}
  /** Expressions (source text) that are a fixed-origin URL. `name()` matches any call to `name`. */
  trustedOrigins?: string[]; // default []
  /** Functions whose result is a safe same-origin path. */
  sanitizers?: string[]; // default []
  /** Expressions (source text) that hold a safe same-origin path, e.g. an imported constant. */
  trustedPaths?: string[]; // default []
};
```

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
