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

### Node clients, axios configs and sockets

The default `fetchCallees` cover `fetch`, `axios` with its methods, `axios(config)`,
`axios(url, config)`, `axios.request(config)`, and Node's `http.get`, `http.request`, `https.get`
and `https.request`. When the URL argument is an object literal, or an in-file `const` bound to one,
the URL is its `urlProperty` (`url` for the axios config forms). An `http` / `https` options object
without `href` names its target by `host` / `hostname`, which must then be fixed.

```ts bad
export async function probe(target: string) {
  const outbound = { method: 'get', url: String(target), timeout: 5000 };
  await axios.request(outbound);
}
```

`socketCallees` (`net.connect`, `net.createConnection`, `tls.connect`) open a raw socket, so only
their host is checked: `connect(port, host)` or `connect({ host })`. A literal host, a `const` bound
to one, a string first argument (an IPC path) and no host at all (localhost) pass.

```ts bad
// `new URL(...).hostname` of a runtime URL is still a runtime host
net.connect(80, new URL(String(target)).hostname);
```

```ts good
net.connect(6379, 'cache.internal');
```

## What it does not flag

- Relative URLs (`/api/todos/${id}`): a runtime part can only move the path.
- An absolute URL whose authority is closed by `/`, `?` or `#` before the first runtime part
  (`https://api.example.com/users/${id}`, `https://api.example.com?q=${q}`).
- A `const` bound to a literal URL, followed through templates, `+`, `new URL(relative, base)`,
  `.toString()` and `.href`.
- A `trustedOrigins` match followed by `/`, `?`, `#`, a sanitizer or a trusted path.
- Calls to an HTTP client not listed in `fetchCallees`: a custom client is out of scope until you add it.
  Named imports (`import { get } from 'node:http'`) are not matched either; list them by name.
- A host-pinned URL: its host was read with `new URL(url).hostname` (or `.host` / `.origin`, with no
  base argument) into a binding that passed an allowlist before the call (an `if` that exits, or an
  `if` around it), and the URL was not written after the read. The allowlist is `includes` / `has`
  on in-file literals, `===` against literals, or a regex anchored at both ends, without the `m` flag
  or a `.` wildcard, whose every alternative ends in a literal domain. `new URL(pinned).hostname`
  passed as a socket host is pinned too.

```ts good
// only two hosts get past the check
export function probe(input: string) {
  let host = '';
  try {
    host = new URL(input).hostname;
  } catch {
    return;
  }
  if (!/^(api|assets)\.example\.com$/.test(host)) return;
  net.connect(80, new URL(String(input)).hostname);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchCallees` | `(string \| CalleeSpec)[]` | `fetch`, `axios`, `axios.{get,post,put,patch,delete,head,options,request}`, `http.{get,request}`, `https.{get,request}` | Call shapes that issue a request. Setting this replaces the defaults. |
| `socketCallees` | `string[]` | `net.connect`, `net.createConnection`, `tls.connect` | Calls that open a socket; their host must be fixed. Setting this replaces the defaults. |
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
    'fetch',
    'this.http.get',
    { object: 'ky', name: 'post' },
    { object: 'client', name: 'request', urlArgument: 1 }, // client.request('GET', url)
  ],
}],
```

The same `fetchCallees` list works for async-safety `require-fetch-timeout`, contracts `fetch-must-check-ok` and security `no-user-controlled-fetch-url`, so declare a wrapper once and pass it to all three. An entry is a string (`'http.fetchWithRetry'`: the last segment is the method, the rest the receiver as written) or an object (`{ object: 'axios', name: 'get', urlArgument: 0, urlProperty: 'url' }`). The object form is needed only when the URL is not the first argument or sits in a property other than `href`.

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
