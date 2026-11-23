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
and `https.request`. An options or config object is read when it is an object literal, or an
in-file `const` bound to one that nothing changes before the call (`opts.host = x`,
`Object.assign(opts, ...)` or handing it to a helper makes it unreadable, and then it is reported as
a runtime URL). Later keys win, a spread of such an object copies its keys, and a spread or computed
key the rule cannot read (`...req.body`, `[key]: value`) is reported, since it may set any key.

**Node `http` / `https`.** The rule reads the options the way Node picks the target. With
`http.get(url, options)`, each key of `options` overrides the same part of the URL, so both are
checked. Node takes `hostname` over `host` and does not read `href` on a plain options object, so
every one of these keys must be fixed (a literal, or an in-file `const` built from literals):

| Key | Why it moves the request |
| --- | --- |
| `hostname`, `host` | the machine; `hostname` wins when both are set. A host-pinned value passes. |
| `port`, `defaultPort` | the port on that machine (`defaultPort` applies when `port` is missing) |
| `socketPath` | a Unix socket that replaces the host and port |
| `protocol` | the scheme the agent must speak |
| `path` | sent as the request target: a `//host` path or a full URL is followed by a proxy. Checked like a URL, so a relative path with a fixed prefix passes. |
| `agent`, `lookup`, `createConnection` | open the connection themselves. Author-written code passes: a function, `new Agent(...)`, `this.agent`, or a `const`, function, class or import binding. |

An options object with none of these keys goes to `localhost:80` and passes.

```ts bad reports=4
// the second argument overrides the URL's host
https.get('https://api.example.com/x', { hostname: req.query.h });
// Node prefers `hostname` over `host`
http.get({ host: 'api.example.com', hostname: req.query.h });
// `href` is not read on a plain options object, so `host` decides
http.get({ href: '/safe', host: req.query.h });
// a spread can override the fixed host
http.get({ hostname: 'api.example.com', ...req.body });
```

```ts good
const keepAlive = new https.Agent({ keepAlive: true });
https.get({ hostname: 'api.example.com', port: 443, agent: keepAlive, path: `/v1/users/${id}` });
```

**axios.** The config keys `url` and `baseURL` must have a fixed origin (axios joins a relative `url`
to `baseURL`), `socketPath` must be fixed, `proxy` must be `false` or an object with a fixed host and
port, and `httpAgent`, `httpsAgent` and `lookup` must be author-written. The config is read in every
call form: `axios(config)`, `axios(url, config)`, `axios.request(config)`, `axios.get(url, config)`,
`axios.post(url, data, config)` and `axios.create(config)`. A `const api = axios.create(...)` in the
same file is an axios instance: `api(config)`, `api.get(url, config)` and the other methods are read
the same way. `axios.defaults.baseURL = x` and `api.defaults.baseURL = x` must have a fixed origin
too.

```ts bad reports=3
export async function probe(target: string) {
  const outbound = { method: 'get', url: String(target), timeout: 5000 };
  await axios.request(outbound);
  await axios.get('/users', { baseURL: req.query.base });
  const api = axios.create({ baseURL: req.query.base });
}
```

**Sockets.** `socketCallees` (`net.connect`, `net.createConnection`, `tls.connect`) open a raw
socket. The host (`connect(port, host)` or `{ host }`), the port and an IPC `path` must be fixed,
and `lookup` author-written. A string literal first argument is a fixed IPC path, and no host means
localhost. Every options object among the arguments is read, since `tls.connect(port, host, options)`
lets `options.host` override the positional host.

```ts bad reports=2
// `new URL(...).hostname` of a runtime URL is still a runtime host
net.connect(80, new URL(String(target)).hostname);
// the options object overrides the positional host
tls.connect(443, 'api.example.com', { host: req.query.h });
```

```ts good
net.connect(6379, 'cache.internal');
net.connect({ path: '/var/run/app.sock' });
```

`fetch(new Request(input))` and a `const` bound to `new Request(input)` are judged by `input`.

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
  passed as a socket host is pinned too. The host can also be checked inline
  (`HOSTS.includes(new URL(url).hostname)`), or on a parsed `const u = new URL(...)` that the call
  then receives as `u`, `u.href` or `u.toString()`, as long as nothing changes `u` after the check
  (`u.host = other`, `Object.assign(u, ...)`, `Reflect.set(u, ...)`, a write through an alias, or
  handing `u` to a helper cancels it; handing it to the request call itself does not). The list can
  be a `const` string (`u.origin === APP_ORIGIN`). See Limits below: a `hostname` check leaves
  the port open, and redirects are followed.

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

### Limits

- **A host pin does not pin the port.** `new URL(input).hostname` is the host without its port, so
  `https://api.example.com:6379/` passes a `hostname` allowlist and the request goes to port 6379
  of the allowed host. Check `host` (host and port) or `origin` (scheme, host and port) instead
  when the port matters: `ALLOWED_ORIGINS.has(new URL(input).origin)`.
- **Redirects are followed.** The rule checks where the request starts. `fetch` and axios follow
  redirects by default, so an allowed host that answers with a `3xx` to an internal address takes
  the request there. Node's `http` / `https` do not follow redirects, but a wrapper that does
  (`follow-redirects`) has the same effect. When the allowed host can be made to redirect, send the
  request with `redirect: 'manual'` (`fetch`) or `maxRedirects: 0` (axios) and check each hop.
- An options object the rule cannot see is not read: a parameter or a call result passed as the
  second argument of `https.get(url, options)` or as an axios config after the URL. An in-file
  `const` object changed before the call is reported in those places, and a first argument the rule
  cannot see is reported as a runtime URL.
- An axios instance is seen only as a `const` bound to `axios.create(...)` in the same file.
- A reverse proxy that forwards `req.url` as the `path` of a fixed host is reported: `req.url` can
  be a full URL. Name your path sanitizer in `sanitizers`.
- Other clients (`undici`'s `request`, `Client` and `Pool`, `got`, `ky`) are not in the defaults.
  A call such as `request(url)` or `got(url)` can be added to `fetchCallees`; a constructor such as
  `new Client(origin)` cannot, and `got`'s `prefixUrl` is not read.
- The rule does not judge the host itself: a fixed `http://127.0.0.1/` or a pin that lists
  `localhost` is the author's choice. A pin compares the host as the URL parser normalizes it, so
  decimal, octal, hex and IPv6 spellings of an internal address never equal a listed domain name.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchCallees` | `(string \| CalleeSpec)[]` | `fetch`, `axios`, `axios.{get,post,put,patch,delete,head,options,request}`, `http.{get,request}`, `https.{get,request}` | Call shapes that issue a request. Setting this replaces the defaults. |
| `socketCallees` | `string[]` | `net.connect`, `net.createConnection`, `tls.connect` | Calls that open a socket; their host, port and IPC path must be fixed. Setting this replaces the defaults. |
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
