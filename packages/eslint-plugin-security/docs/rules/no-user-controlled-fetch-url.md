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
| only scheme characters that can start a scheme which leaves the origin or runs script (`h`, `java`, `dat`, `ws`, any case), then a runtime part | flag: `p = "ttps://evil.com"` makes a full URL |
| other scheme characters (`api`, `users`), then a runtime part | ok: `p` can only make a path or a scheme `fetch` refuses |
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
`Object.assign(opts, ...)` or handing it to a helper makes it unreadable, and so does exporting
it, since an importing module can change it: `as const` freezes only the type). Copying it with
`Object.assign({}, opts)` keeps it readable only when every value in it is a primitive, or when the
fresh copy goes straight into the request call: the copy is shallow, so a nested object such as
`proxy` stays shared and a write through the copy changes `opts` too. `as`, `satisfies`,
`!` and `<T>` around the object or the `const` are seen through. Later keys win, a spread of such
an object copies its keys, and a spread or computed key the rule cannot read (`...req.body`,
`[key]: value`) is reported, since it may set any key. `__proto__: value` sets the prototype, which
the client reads every key it does not find through: a prototype the rule cannot read is reported
the same way, and `__proto__: null` adds nothing.

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
| `agent`, `lookup`, `createConnection` | open the connection themselves. Author-written code passes: a function, `new Agent(...)`, `this.agent`, a function, class or import binding, or a `const` that holds one of these (not `const a = req.body.agent`, nor a call result). |

An options object with none of these keys goes to `localhost:80` and passes.

Options after the URL that the requester supplies whole (`https.get(url, req.body)`, or a binding
that holds it) are reported, and so is `Object.assign(...)` with a source the rule cannot read.
Each branch of `?:`, `||`, `&&` and `??` is checked on its own, so
`cond ? { hostname: x } : {}` is read as both objects.

```ts bad reports=6
// the second argument overrides the URL's host
https.get('https://api.example.com/x', { hostname: req.query.h });
// the requester picks every option, including `hostname` and `socketPath`
https.get('https://api.example.com/x', req.body);
// the prototype supplies `host`
net.connect({ __proto__: req.body, port: 80 });
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
`axios.post(url, data, config)` (also `postForm`, `putForm` and `patchForm`) and
`axios.create(config)`. `axios` is also seen behind a type wrapper (`(axios as any).get(...)`) or
a binding that holds it (`const ax = axios`). A `const api = axios.create(...)` in the same file is
an axios instance: `api(config)`, `api.get(url, config)` and the other methods are read the same
way. The defaults every later request starts from are checked like a config:
`axios.defaults.baseURL = x`, `axios.defaults['proxy'] = x`, `axios.defaults = config` and
`Object.assign(axios.defaults, config)`, on `axios` or an instance. A key computed at run time
(`axios.defaults[key] = x`) is reported, since it may be `baseURL`.

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

`fetch(new Request(input))` and a `const` bound to `new Request(input)` are judged by `input`, and
undici's `new Client(origin)` and `new Pool(origin)` (imported from `undici`) by `origin`.

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
  or a `.` wildcard, whose every alternative ends in a literal domain. A domain that ends in a
  common public suffix (`vercel.app`, `github.io`, `netlify.app`, `pages.dev`, `s3.<region>.amazonaws.com`, `co.uk` and similar)
  needs one more literal label before it, since anyone can register `evil.vercel.app`; the list is
  short and built in. `new URL(pinned).hostname`
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
- An options object the rule cannot read after the URL is left alone when it is a parameter or a
  call result (`https.get(url, options)`, `https.get(url, withAuth(token))`), or an axios config
  after the URL of that kind: the rule does not judge what a caller or a helper hands over. An
  in-file `const` object changed before the call, an exported one, an `Object.assign` with a
  source the rule cannot read and an object the requester supplies (`req.body`, or a binding that
  holds it) are reported in those places. A first argument
  the rule cannot read (a parameter, `req.body`, a conditional, a call result, a changed `const`)
  is always reported: as a runtime URL for `fetch`, `http` / `https`, `axios(...)` and
  `axios.request(...)`, as a runtime port, path or options object for a socket, and as a runtime
  config for `axios.create(...)`.
- An axios instance is seen only as a binding that holds `axios.create(...)` in the same file.
- A reverse proxy that forwards `req.url` as the `path` of a fixed host is reported: `req.url` can
  be a full URL. Name your path sanitizer in `sanitizers`.
- undici's `request`, `stream` and `fetch`, `got` and `ky` are not in the defaults: the rule
  cannot yet read some checks that guard them in practice (a zod `refine`, a literal table read
  behind a conditional), so it would report safe code. Add the calls you use to `fetchCallees`
  (`'got'`, `'got.post'`, `'ky'`, `'ky.get'`, `'request'`): a default import or a `require` under
  another name is matched by its usual name, and `'request'` matches every bare `request(...)`
  call, whatever it is. Their own options are not read:
  `got`'s and `ky`'s `prefixUrl`, undici's `dispatcher`, and instances made with `got.extend`,
  `ky.create` or `ky.extend`. undici's `Client` and `Pool` are checked (see above); `BalancedPool`
  and an `Agent`'s `connect` option are not.
- The rule does not judge the host itself: a fixed `http://127.0.0.1/` or a pin that lists
  `localhost` is the author's choice. A pin compares the host as the URL parser normalizes it, so
  decimal, octal, hex and IPv6 spellings of an internal address never equal a listed domain name.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchCallees` | `(string \| CalleeSpec)[]` | `fetch`, `axios`, `axios.{get,post,put,patch,delete,head,options,postForm,putForm,patchForm,request}`, `http.{get,request}`, `https.{get,request}` | Call shapes that issue a request. Setting this replaces the defaults. |
| `socketCallees` | `string[]` | `net.connect`, `net.createConnection`, `tls.connect` | Calls that open a socket; their host, port and IPC path must be fixed. Setting this replaces the defaults. |
| `trustedOrigins` | `string[]` | `[]` | Expressions (source text) that are a fixed-origin URL. `name()` matches any call to `name`. |
| `sanitizers` | `string[]` | `[]` | Functions whose result is a safe same-origin path. |
| `trustedPaths` | `string[]` | `[]` | Expressions (source text) that hold a safe same-origin path, e.g. an imported constant. |
| `trustedSources` | `string[]` | `[]` | For CLI and test code: variables whose value the person running the program picks, such as a CLI config or flag. The variable and every property read off it count as a trusted origin, and as a fixed host for `hostname` and `host`, unless the binding is a parameter, is written (also through an alias or a global object), is handed to a call that may change it, or takes request data. Helpers are not followed: handing the source to one ends the trust. |
| `allowLoopback` | `boolean` | `false` | Trust a URL whose author-written text names `localhost`, `127.0.0.1` or `[::1]`, followed by a port the rule can see is a number. |

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

### `trustedSources`

This option is meant for CLI and test code, where the person running the program picks the base
URL, in a config file or a flag, so no requester can move it. Do not turn it on for server code.
Name the variable the value comes from once. An entry covers the expression itself and every
property read off it by name or literal key (`config` covers `config.registryUrl`,
`config?.mirrors[0]` and `config['registryUrl']`, not `config[key]`).

The entry names a binding, not just text, so a matching name is not enough. The source is trusted
only when its root is a variable or an import, and:

- it is not a function parameter (a caller fills it) and not rooted at `this` or a call result;
- it never takes its value from request data along the value flow (`const config = req.body`,
  `const { config } = req.body`), nor from a handler's response (`const config = res.locals.cfg`);
- it is never reassigned (`config = req.body`, or `globalThis.config = x` for an undeclared
  global), and no property under it is written: `config.url = x`, `delete config.url`,
  `({ url: config.url } = x)`, `Object.assign(config, x)`, `config.mirrors.push(x)`;
- it is never handed to a call that may change it. Only the rule's own request calls and a few
  known readers (`String`, `Number`, `encodeURIComponent`, `new URL`, `JSON.stringify`,
  `Object.keys`, `console.log`) count as reading; `merge(config, req.body)`, `_.set(config, ...)`,
  `mutate(config.http)` and `Object.assign({}, config)` end the trust, since helpers are not
  followed;
- it never leaves through a `return`, a `throw`, a tagged template or an `export const`;
- a copy of it or of anything under it in a local binding (`const c = config`,
  `const { mirrors } = config`, `const m = config.mirrors`, `for (const m of config.mirrors)`, the
  parameter of a callback such as `config.mirrors.forEach((m) => ...)`, `{ ...config }`) keeps to
  the same rules: `const c = config; c.url = x` ends the trust in `config`.

The copy itself is not trusted: `fetch(c.url)` after `const c = config` is read like any other
binding. The checks do not follow the order of statements, so a write anywhere in the file counts.
Writes made in another module are not seen, which is why the option belongs only in code that never
handles requests. Limit it to those files with a `files` override:

```js
// eslint.config.js
export default [
  // ...
  {
    files: ['bin/**', 'src/cli/**', '**/*.test.ts'],
    rules: {
      'noctcore-security/no-user-controlled-fetch-url': ['error', {
        trustedSources: ['config', 'argv.registry'],
      }],
    },
  },
];
```

```ts good options={"trustedSources":["config","argv.registry"]}
// with the options above
const config = await loadConfig();
await fetch(new URL(`r/${name}.json`, config.registryUrl));
await fetch(`${argv.registry}/r/${name}.json`);
https.get({ hostname: config.host, path: `/r/${name}` });
```

```ts bad options={"trustedSources":["config","argv.registry"]} reports=2
// still flagged: the runtime path can be a whole URL with its own host
await fetch(new URL(path, config.registryUrl));
// still flagged: nothing closes the authority after the trusted source
await fetch(`${config.registryUrl}${path}`);
```

```ts bad options={"trustedSources":["config"]} reports=2
// still flagged: the name matches, but the binding holds request data
function handler(req) {
  const config = req.body;
  return fetch(config.url);
}
// still flagged: a parameter is filled by whoever calls the function
function load(config) {
  return fetch(config.url);
}
```

A trusted source is a trusted origin, nothing more: what follows it must still close the authority.
### `allowLoopback`

Integration tests often start a server on a random port and call it on loopback. With
`allowLoopback`, a URL passes when its author-written text is `http://`, `https://`, `ws://` or
`wss://`, then `localhost`, `127.0.0.1` or `[::1]` and a `:`, then a port the rule can see is a number
(a number literal, `Number(x)`, `parseInt(x)`, `Number.parseInt(x)`, `Math.max`, `min`, `floor`,
`trunc`, `round`, `abs` or `ceil`, unary `+` or `-`, or arithmetic other than `+`), then nothing or `/`, `?` or `#`:

```ts good options={"allowLoopback":true}
// with allowLoopback: true
await fetch(`http://127.0.0.1:${Number(port)}/health`);
await fetch(`http://localhost:${+port}/api/${id}`);
```

```ts bad options={"allowLoopback":true} reports=3
// still flagged: the rule cannot see that `port` is a number, and `port = "1@evil.com"` moves the host
await fetch(`http://localhost:${port}/health`);
// still flagged: nothing closes the authority after the port
await fetch(`http://localhost:${Number(port)}${path}`);
// still flagged: a runtime value is never trusted for looking like loopback
await fetch(target);
```

When the port comes from `server.address()`, wrap it: `Number(address.port)`. The host must be
written in the URL text itself; a runtime value that happens to hold `localhost` is still reported.
The option applies to URLs only, not to `hostname` and `port` request options.

## When not to use it

In code where every outbound URL is deliberately runtime (a proxy, a webhook dispatcher, a crawler),
this rule is the wrong tool: validate against an allowlist at the call site and turn the rule off for
that directory.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT).
