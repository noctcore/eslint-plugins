import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUserControlledFetchUrlRule } from '../../src/rules/no-user-controlled-fetch-url';

const TS = 'client.ts';
const error = { messageId: 'userControlledFetchUrl' } as const;
const host = { messageId: 'userControlledSocketHost' } as const;
const option = { messageId: 'userControlledRequestOption' } as const;

// One wrapper list, declared once and passed to all three fetch rules.
const FETCH_CALLEES = ['fetch', 'http.fetchWithCsrfRetry'];

ruleTester.run('no-user-controlled-fetch-url', noUserControlledFetchUrlRule, {
  valid: [
    // Plain literals and no-interpolation templates.
    { code: `fetch('https://api.example.com/todos');`, filename: TS },
    { code: 'fetch(`https://api.example.com/todos`);', filename: TS },
    // Relative, same origin: the id can only move the path.
    { code: 'fetch(`/api/todos/${id}`);', filename: TS },
    { code: 'fetch(`api/todos/${id}`);', filename: TS },
    { code: 'fetch(`api.json?${q}`);', filename: TS },
    // Authority closed by `/`, `?` or `#` before the first interpolation.
    { code: 'fetch(`https://api.example.com/v${n}/todos`);', filename: TS },
    { code: 'fetch(`https://api.example.com?q=${q}`);', filename: TS },
    { code: 'axios.get(`https://api.example.com/users/${id}`);', filename: TS },
    // A `const` bound to a literal is seen through (the TURNSTILE_VERIFY_URL case).
    {
      code: `const VERIFY_URL = 'https://challenges.example.com/siteverify';\nasync function verify() { return fetch(VERIFY_URL, { method: 'POST' }); }`,
      filename: TS,
    },
    // ...including a const template built on another const, and `as const`.
    {
      code: "const BASE = 'https://api.example.com' as const;\nconst TODOS = `${BASE}/todos`;\nfetch(`${TODOS}/${id}`);",
      filename: TS,
    },
    // `+` concatenation of fixed parts.
    { code: `const BASE = 'https://api.example.com/';\nfetch(BASE + path);`, filename: TS },
    // `new URL(relative, fixedBase)` and `.toString()` / `.href`.
    {
      code: `const url = new URL('/todos', 'https://api.example.com');\nfetch(url.toString());\nfetch(url.href);`,
      filename: TS,
    },
    // A trusted origin followed by `/`.
    {
      code: 'fetch(`${getApiBaseUrl()}/todos/${id}`);\nfetch(getApiBaseUrl() + "/csrf");',
      filename: TS,
      options: [{ trustedOrigins: ['getApiBaseUrl()'] }],
    },
    // A trusted origin followed by a trusted imported path constant.
    {
      code: 'fetch(getApiBaseUrl() + CSRF_TOKEN_PATH);',
      filename: TS,
      options: [{ trustedOrigins: ['getApiBaseUrl()'], trustedPaths: ['CSRF_TOKEN_PATH'] }],
    },
    // A trusted member-expression origin followed by a sanitized path.
    {
      code: 'fetch(`${this.config.apiUrl}${toSafePath(input)}`);',
      filename: TS,
      options: [{ trustedOrigins: ['this.config.apiUrl'], sanitizers: ['toSafePath'] }],
    },
    // Not a configured callee: a custom client is not this rule's business by default.
    { code: 'client.get(url);', filename: TS },
    // A method *definition* named fetch is not a call.
    { code: 'const client = { fetch(url: unknown) { return url; } };', filename: TS },
    // A numeric segment is author text too.
    { code: `fetch('https://api.example.com/v' + 2 + '/todos');`, filename: TS },
    // Node clients, axios config objects and sockets with fixed targets.
    { code: "http.get('http://internal.example.com/health');", filename: TS },
    { code: 'https.request(`https://api.example.com/users/${id}`);', filename: TS },
    { code: "http.get({ host: 'internal.example.com', path: `/users/${id}` });", filename: TS },
    { code: "const HOST = 'internal.example.com'; http.request({ hostname: HOST, path: `/users/${id}` });", filename: TS },
    { code: 'http.get({ path: `/users/${id}` });', filename: TS },
    { code: "axios.request({ method: 'get', url: `/api/users/${id}` });", filename: TS },
    { code: "const config = { method: 'get', url: 'https://api.example.com/x' }; await axios.request(config);", filename: TS },
    { code: "axios({ url: '/api/ping', timeout: 1000 });", filename: TS },
    { code: "axios('https://api.example.com/x', { timeout: 1000 });", filename: TS },
    { code: "net.connect(6379, 'cache.internal');", filename: TS },
    { code: "tls.connect({ host: 'db.internal', port: 5432 });", filename: TS },
    { code: "net.connect('/var/run/app.sock');", filename: TS },
    { code: 'net.connect(6379, () => ready());', filename: TS },
    { code: 'const PORT = 6379; net.createConnection(PORT);', filename: TS },
    // A URL whose host passed an anchored allowlist first.
    {
      code: "function probe(input: string) { let host = ''; try { host = new URL(String(input)).hostname; } catch { return; } if (!/^(api|assets)\\.example\\.com$/.test(host)) return; const target = input; http.get(target); }",
      filename: TS,
    },
    {
      code: "function probe(input: string) { const host = new URL(input).hostname; if (!['api.example.com'].includes(host)) throw new Error('host'); const outbound = { method: 'get', url: String(input) }; return axios.request(outbound); }",
      filename: TS,
    },
    {
      code: "function probe(input: string) { const host = new URL(input).hostname; if (!/^api\\.example\\.com$/.test(host)) return; net.connect(80, new URL(String(input)).hostname); }",
      filename: TS,
    },
    // A parsed URL object whose host was checked.
    {
      code: "const CDN = new Set(['cdn.example.com']); async function h(src: string) { const u = new URL(src); if (u.protocol !== 'https:' || !CDN.has(u.hostname)) throw new Error('host'); return fetch(u); }",
      filename: TS,
    },
    {
      code: "const APP_ORIGIN = 'https://app.example.com'; async function h(next: string) { const u = new URL(next, APP_ORIGIN); if (u.origin !== APP_ORIGIN) return; await fetch(u.href); }",
      filename: TS,
    },
    {
      code: "const HOSTS = ['api.example.com']; async function h(url: string) { if (!HOSTS.includes(new URL(url).hostname)) return; await fetch(url); }",
      filename: TS,
    },
    // Node options with every target key fixed, a fixed spread, and keys that do not move the target.
    {
      code: "const keepAlive = new https.Agent({ keepAlive: true }); https.get({ hostname: 'api.example.com', port: 443, protocol: 'https:', agent: keepAlive, path: `/v1/users/${id}` });",
      filename: TS,
    },
    { code: "const BASE = { hostname: 'api.example.com', port: 8443 }; https.get({ ...BASE, path: '/health' });", filename: TS },
    { code: "https.get('https://api.example.com/x', { headers: { authorization: token }, timeout: 1000 }, (res) => res.resume());", filename: TS },
    { code: "const opts = { hostname: 'api.example.com' }; log(opts.hostname); http.get(opts);", filename: TS },
    { code: "http.get({ hostname: 'api.example.com', lookup: customLookup }); function customLookup() {}", filename: TS },
    // axios configs and instances with a fixed base URL.
    { code: "axios({ baseURL: 'https://api.example.com', url: `/users/${id}` });", filename: TS },
    { code: "const api = axios.create({ baseURL: 'https://api.example.com', timeout: 5000 }); api.get(`/users/${id}`); api.post('/users', body, { headers });", filename: TS },
    { code: "axios.defaults.baseURL = 'https://api.example.com';", filename: TS },
    { code: "axios.get('/x', { proxy: false, socketPath: '/var/run/app.sock' });", filename: TS },
    // Sockets: an options object without target keys, and a fixed IPC path.
    { code: "tls.connect(443, 'api.example.com', { servername: 'api.example.com' });", filename: TS },
    { code: "net.connect({ path: '/var/run/app.sock' });", filename: TS },
    // A Request built from a fixed URL.
    { code: "fetch(new Request('https://api.example.com/x', { method: 'POST' }));", filename: TS },
    { code: "const request = new Request(`/api/users/${id}`); await fetch(request);", filename: TS },
    // A pinned host read again as the options host.
    {
      code: "const HOSTS = ['api.example.com']; function probe(input: string) { const host = new URL(input).hostname; if (!HOSTS.includes(host)) return; https.get({ hostname: new URL(input).hostname, path: '/x' }); }",
      filename: TS,
    },
    // Trailing options the rule cannot see are left alone: a parameter, a callback, a call result.
    { code: "function get(options) { return https.get('https://api.example.com/x', options); }", filename: TS },
    { code: "https.get('https://api.example.com/x', (res) => res.pipe(out));", filename: TS },
    { code: "https.get('https://api.example.com/x', withAuth(req.headers.authorization));", filename: TS },
    { code: "net.connect(6379, 'cache.internal', () => res.json(req.body));", filename: TS },
    // ...and trailing options the rule can read, through a conditional or Object.assign.
    { code: "https.get('https://api.example.com/x', cond ? { timeout: 1000 } : undefined);", filename: TS },
    { code: "https.get('https://api.example.com/x', { headers: { 'x-user': req.body.name } });", filename: TS },
    {
      code: "const BASE = { headers: { accept: 'application/json' } }; https.get('https://api.example.com/x', Object.assign({}, BASE, { timeout: 5000 }));",
      filename: TS,
    },
    { code: "axios.get('https://api.example.com/x', req.body.flag ? { timeout: 1000 } : {});", filename: TS },
    // A prototype that sets nothing, or only fixed keys.
    { code: "net.connect({ __proto__: null, host: 'db.internal', port: 5432 });", filename: TS },
    { code: "net.connect({ __proto__: { host: 'db.internal' }, port: 5432 });", filename: TS },
    { code: "net.connect({ ['__proto__']: req.body, host: 'db.internal', port: 5432 });", filename: TS },
    // axios defaults set to fixed values, and keys that do not move the request.
    { code: "axios.defaults['baseURL'] = 'https://api.example.com';", filename: TS },
    { code: "Object.assign(axios.defaults, { baseURL: 'https://api.example.com', timeout: 5000 });", filename: TS },
    { code: 'axios.defaults.timeout = Number(req.query.t); axios.defaults.headers.common.authorization = token;', filename: TS },
    // The axios form methods with a fixed URL.
    { code: "axios.postForm('/upload', form); axios.putForm('https://api.example.com/x', form, { timeout: 1000 });", filename: TS },
    // undici clients on a fixed origin, and a Client that is not undici's.
    { code: "import { Client, Pool } from 'undici'; new Client('https://api.example.com'); new Pool('http://localhost:3000');", filename: TS },
    { code: "import { Client } from './client'; new Client(target);", filename: TS },
    // Hooks that are author-written, directly or through a const.
    { code: "import { Agent } from 'node:https'; const agent = new Agent({ keepAlive: true }); const hook = agent; https.get({ hostname: 'api.example.com', agent: hook });", filename: TS },
    // An exported string is fixed: a string cannot change.
    { code: "export const HOST = 'api.example.com'; https.get({ hostname: HOST, path: '/x' });", filename: TS },
    // axios through an alias or a type wrapper, with a fixed URL.
    { code: "const ax = axios; ax.get('https://api.example.com/x'); (axios as any).post('/x', body);", filename: TS },
    // Opt-in: values the person running the program picks, and their properties.
    {
      code: 'fetch(new URL(`r/${name}.json`, config.registryUrl));',
      filename: TS,
      options: [{ trustedSources: ['config.registryUrl'] }],
    },
    {
      code: "fetch(`${config.registryUrl}/r/${name}.json`); fetch(config?.mirrors[0]); fetch(config['registryUrl']);",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
    },
    {
      code: 'const base = argv.registry; fetch(base); https.get({ hostname: argv.host, path: `/r/${name}` });',
      filename: TS,
      options: [{ trustedSources: ['argv'] }],
    },
    {
      code: "axios.create({ baseURL: options.registry }); axios.get('/r', { baseURL: options.registry });",
      filename: TS,
      options: [{ trustedSources: ['options.registry'] }],
    },
    // Opt-in: a loopback host written in full, then a port that is a number.
    {
      code: [
        'fetch(`http://127.0.0.1:${Number(port)}/health`);',
        'fetch(`http://localhost:${Number(process.env.PORT)}`);',
        'fetch(`http://[::1]:${+port}?q=${q}`);',
        "fetch('http://LOCALHOST:' + parseInt(port, 10) + '/x/' + id);",
        'fetch(new URL(`/api/${id}`, `https://127.0.0.1:${Number.parseInt(port)}`));',
        'fetch(`ws://localhost:${base + 1 - 1}#x`);',
        'fetch(`http://localhost:${Math.max(1024, Math.floor(port))}/x`);',
        'const p = Number(port); fetch(`http://localhost:${p}/x`);',
      ].join('\n'),
      filename: TS,
      options: [{ allowLoopback: true }],
    },
    // A source of Object.assign whose values are all primitives cannot change through the copy.
    {
      code: "const base = { hostname: 'api.example.com', port: 443, path: `/v1`, agent: undefined, family: null }; const copy = Object.assign({}, base); copy.path = '/v2'; https.get(base);",
      filename: TS,
    },
    // A trusted source read from a binding nothing rewrites and no request fills.
    {
      code: "import config from './config'; const cli = loadConfig(); fetch(config.url); fetch(cli.url); https.get({ hostname: cli.host, path: '/x' }); log(config.url.replace(a, b));",
      filename: TS,
      options: [{ trustedSources: ['config', 'cli'] }],
    },
    // A hook the author wrote, reached through a later assignment or a callback's value.
    {
      code: "import { Agent } from 'node:https'; let a; a = new Agent({ keepAlive: true }); https.get({ hostname: 'api.example.com', agent: a });",
      filename: TS,
    },
    {
      code: "import { Agent } from 'node:https'; [new Agent()].forEach((agent) => https.get({ hostname: 'api.example.com', agent }));",
      filename: TS,
    },
    // A host regex over a public suffix with one more literal label pinned.
    {
      code: "async function h(src: string) { if (!/^[a-z0-9-]+\\.assets\\.github\\.io$/.test(new URL(src).hostname)) return; await fetch(src); }",
      filename: TS,
    },
    // A fixed options object behind a type wrapper is read as written.
    { code: "const opts = { hostname: 'api.example.com' } satisfies RequestOptions; https.get(opts);", filename: TS },
    { code: "https.get({ hostname: 'api.example.com', path: '/x' } as https.RequestOptions);", filename: TS },
    { code: "axios.create({ baseURL: 'https://api.example.com' } as const); axios.create();", filename: TS },
  ],
  invalid: [
    // The shared wrapper list, string form.
    { code: 'http.fetchWithCsrfRetry(url);', filename: TS, options: [{ fetchCallees: FETCH_CALLEES }], errors: [error] },
    // A bare runtime value.
    { code: 'fetch(url);', filename: TS, errors: [error] },
    { code: 'axios.post(target, body);', filename: TS, errors: [error] },
    // Runtime host position.
    { code: 'fetch(`https://${host}/todos`);', filename: TS, errors: [error] },
    // Protocol-relative runtime host.
    { code: 'fetch(`//${host}/todos`);', filename: TS, errors: [error] },
    // Extra slashes still open the authority, and the parser drops a tab.
    { code: 'fetch(`https:///${host}/todos`);', filename: TS, errors: [error] },
    { code: 'fetch(`/\\t${path}`);', filename: TS, errors: [error] },
    // Empty first quasi: the whole URL is runtime.
    { code: 'fetch(`${base}/api/todos`);', filename: TS, errors: [error] },
    // The userinfo trick: `path = "@evil.com/x"` moves the host.
    { code: 'fetch(`https://api.example.com${path}`);', filename: TS, errors: [error] },
    // ...and the same trick behind a const that looks fixed.
    {
      code: "const API = 'https://api.example.com';\nfetch(API + path);",
      filename: TS,
      errors: [error],
    },
    // ...and behind a trusted origin with nothing closing the authority.
    {
      code: 'fetch(`${getApiBaseUrl()}${path}`);',
      filename: TS,
      options: [{ trustedOrigins: ['getApiBaseUrl()'] }],
      errors: [error],
    },
    // A lone `/` prefix: `p = "/evil.com"` makes it protocol-relative.
    { code: 'fetch(`/${p}`);', filename: TS, errors: [error] },
    // A backslash reads as a slash in browsers: `/\\evil.com` is protocol-relative.
    { code: 'fetch(`/\\\\${host}`);', filename: TS, errors: [error] },
    // A scheme without `//`: the runtime part can supply `//evil.com`.
    { code: 'fetch(`https:${rest}`);', filename: TS, errors: [error] },
    // `let` is not resolved: it can be reassigned.
    { code: `let target = 'https://api.example.com/x';\nfetch(target);`, filename: TS, errors: [error] },
    // `new URL(input, base)` with a runtime base.
    { code: `fetch(new URL('/todos', base));`, filename: TS, errors: [error] },
    // Configured callee with a non-zero URL argument.
    {
      code: 'this.http.request("GET", url);',
      filename: TS,
      options: [{ fetchCallees: [{ object: 'this.http', name: 'request', urlArgument: 1 }] }],
      errors: [error],
    },
    // Node clients, axios config objects and sockets with runtime targets.
    { code: 'http.get(req.query.url);', filename: TS, errors: [error] },
    { code: 'https.get(String(target), (res) => res.resume());', filename: TS, errors: [error] },
    { code: 'http.request({ host: req.query.host, path: "/" });', filename: TS, errors: [{ messageId: 'userControlledSocketHost' }] },
    { code: 'axios.request({ method: "get", url: String(target) });', filename: TS, errors: [error] },
    {
      code: "const outbound = { method: 'get', url: String(target), timeout: 5000 }; await axios.request(outbound);",
      filename: TS,
      errors: [error],
    },
    { code: 'axios({ url: target });', filename: TS, errors: [error] },
    { code: 'axios(target, { timeout: 1000 });', filename: TS, errors: [error] },
    { code: 'net.connect(80, host);', filename: TS, errors: [{ messageId: 'userControlledSocketHost' }] },
    {
      code: 'net.connect(80, new URL(String(target)).hostname);',
      filename: TS,
      errors: [{ messageId: 'userControlledSocketHost' }],
    },
    { code: 'tls.connect({ host: target, port: 443 });', filename: TS, errors: [{ messageId: 'userControlledSocketHost' }] },
    {
      code: 'net.createConnection(port, host, () => ready());',
      filename: TS,
      errors: [{ messageId: 'userControlledRequestOption' }, { messageId: 'userControlledSocketHost' }],
    },
    // Near misses of the host allowlist.
    {
      code: "function probe(input: string) { const host = new URL(input).hostname; if (!/api\\.example\\.com/.test(host)) return; http.get(input); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function probe(input: string, other: string) { const host = new URL(other).hostname; if (!/^api\\.example\\.com$/.test(host)) return; http.get(input); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function probe(input: string) { http.get(input); const host = new URL(input).hostname; if (!/^api\\.example\\.com$/.test(host)) return; }",
      filename: TS,
      errors: [error],
    },
    // A replaced socket list drops the defaults.
    {
      code: 'sockets.open(80, host);',
      filename: TS,
      options: [{ socketCallees: ['sockets.open'] }],
      errors: [{ messageId: 'userControlledSocketHost' }],
    },
    // The URL object changed after the check, or another URL checked.
    {
      code: "const CDN = new Set(['cdn.example.com']); async function h(src: string, other: string) { const u = new URL(src); if (!CDN.has(u.hostname)) return; u.host = other; return fetch(u); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const CDN = new Set(['cdn.example.com']); async function h(src: string, other: string) { const u = new URL(src); const v = new URL(other); if (!CDN.has(v.hostname)) return; return fetch(u); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "async function h(src: string) { const u = new URL(src); if (!/example\\.com$/.test(u.hostname)) return; return fetch(u); }",
      filename: TS,
      errors: [error],
    },
    // Node picks the target key by key: options after a URL override it, `hostname` wins over `host`, and `href` is not read.
    { code: "https.get('https://api.example.com/x', { hostname: req.query.h });", filename: TS, errors: [host] },
    { code: "http.get({ host: 'api.example.com', hostname: req.query.h });", filename: TS, errors: [host] },
    { code: "http.get({ href: '/safe', host: req.query.h });", filename: TS, errors: [host] },
    { code: "http.get({ href: 'http://api.example.com/', protocol: 'http:', hostname: req.query.h });", filename: TS, errors: [host] },
    // Every other key that steers the connection.
    { code: "http.get({ host: 'api.example.com', port: req.query.port });", filename: TS, errors: [option] },
    { code: "http.get({ host: 'api.example.com', defaultPort: Number(req.query.port) });", filename: TS, errors: [option] },
    { code: "http.get({ host: 'api.example.com', protocol: req.query.protocol });", filename: TS, errors: [option] },
    { code: "http.get({ hostname: 'api.example.com', socketPath: req.query.socket });", filename: TS, errors: [option] },
    { code: "http.get({ host: 'proxy.internal', path: req.query.url });", filename: TS, errors: [option] },
    { code: "http.get({ host: 'proxy.internal', path: '/' + target });", filename: TS, errors: [option] },
    { code: "http.get({ host: 'proxy.internal', path: `//${target}/x` });", filename: TS, errors: [option] },
    { code: "http.get({ hostname: 'api.example.com', agent: req.body.agent });", filename: TS, errors: [option] },
    {
      code: "function get(lookup: unknown, createConnection: unknown) { http.get({ hostname: 'api.example.com', lookup, createConnection }); }",
      filename: TS,
      errors: [option, option],
    },
    { code: "https.get('https://api.example.com/x', { port: req.query.port }, (res) => res.resume());", filename: TS, errors: [option] },
    // A spread the rule cannot read can override a fixed host, before or after it.
    { code: "http.get({ hostname: 'api.example.com', ...req.body });", filename: TS, errors: [option] },
    { code: "http.get({ ...req.body, hostname: 'api.example.com' });", filename: TS, errors: [option] },
    { code: "https.get('https://api.example.com/x', { ...overrides });", filename: TS, errors: [option] },
    { code: "net.connect({ host: 'db.internal', port: 5432, ...req.body });", filename: TS, errors: [option] },
    { code: "http.get({ [key]: value, hostname: 'api.example.com' });", filename: TS, errors: [option] },
    { code: "http.get({ get hostname() { return req.query.h; } });", filename: TS, errors: [option] },
    // A `const` options object changed before the call is not read as written.
    { code: "const opts = { hostname: 'api.example.com' }; opts.hostname = req.query.h; http.get(opts);", filename: TS, errors: [error] },
    { code: "const opts = { hostname: 'api.example.com' }; Object.assign(opts, req.body); http.get(opts);", filename: TS, errors: [error] },
    { code: "const config = { url: '/api/ping' }; config.url = target; axios.request(config);", filename: TS, errors: [error] },
    {
      code: "const cfg = { baseURL: 'https://api.example.com' }; cfg.baseURL = req.query.base; axios.get('/users', cfg);",
      filename: TS,
      errors: [option],
    },
    {
      code: "const overrides = { timeout: 1000 }; patch(overrides); https.get('https://api.example.com/x', overrides);",
      filename: TS,
      errors: [option],
    },
    {
      code: "const tlsOptions = { servername: 'api.example.com' }; Object.assign(tlsOptions, req.body); tls.connect(443, 'api.example.com', tlsOptions);",
      filename: TS,
      errors: [option],
    },
    // axios `baseURL` from input, in each call form, and the other target keys.
    { code: "axios({ baseURL: req.query.base, url: '/users' });", filename: TS, errors: [error] },
    { code: "axios.request({ baseURL: req.query.base, url: '/users' });", filename: TS, errors: [error] },
    { code: "axios('/users', { baseURL: req.query.base });", filename: TS, errors: [error] },
    { code: "axios.get('/users', { baseURL: req.query.base });", filename: TS, errors: [error] },
    { code: "axios.post('/users', body, { baseURL: req.query.base });", filename: TS, errors: [error] },
    { code: 'axios.create({ baseURL: req.query.base });', filename: TS, errors: [error] },
    {
      code: "const api = axios.create({ baseURL: 'https://api.example.com' }); api.get('/users', { baseURL: req.query.base }); api.get(req.query.url); api({ url: target });",
      filename: TS,
      errors: [error, error, error],
    },
    { code: 'axios.defaults.baseURL = req.query.base;', filename: TS, errors: [error] },
    {
      code: "const api = axios.create({ baseURL: 'https://api.example.com' }); api.defaults.baseURL = req.query.base;",
      filename: TS,
      errors: [error],
    },
    { code: "axios.get('/users', { socketPath: req.query.socket });", filename: TS, errors: [option] },
    { code: "axios.get('/users', { proxy: { host: req.query.h, port: 8080 } });", filename: TS, errors: [host] },
    { code: "axios.get('/users', { proxy: req.body.proxy });", filename: TS, errors: [option] },
    { code: "axios({ url: '/users', ...req.body });", filename: TS, errors: [option] },
    // Socket targets: the port, an IPC path, and options that override a positional host.
    { code: 'net.connect(port, () => ready());', filename: TS, errors: [option] },
    { code: "net.connect({ path: req.query.socket });", filename: TS, errors: [option] },
    { code: "tls.connect(443, 'api.example.com', { host: req.query.h });", filename: TS, errors: [host] },
    { code: "tls.connect(443, { host: req.query.h });", filename: TS, errors: [host] },
    // A Request built from a runtime URL.
    { code: 'fetch(new Request(req.query.url));', filename: TS, errors: [error] },
    { code: 'const request = new Request(target, { method: "POST" }); await fetch(request);', filename: TS, errors: [error] },
    // The checked URL object changed after the check, directly, through an alias or by a helper.
    ...[
      'Object.assign(u, { host: other });',
      "Reflect.set(u, 'host', other);",
      'rewrite(u);',
      'const v = u; v.hostname = other;',
      'u.href = other;',
    ].map((change) => ({
      code: `const CDN = new Set(['cdn.example.com']); async function h(src: string, other: string) { const u = new URL(src); if (!CDN.has(u.hostname)) return; ${change} return fetch(u); }`,
      filename: TS,
      errors: [error],
    })),
    {
      code: "const CDN = new Set(['cdn.example.com']); async function h(src: string, other: string) { const u = new URL(src); if (!CDN.has(u.hostname)) return; return fetch(u, rewrite(u)); }",
      filename: TS,
      errors: [error],
    },
    // Type wrappers do not hide an options or config object.
    {
      code: "const config = { baseURL: hook.url, timeout: 5000 } satisfies CreateAxiosDefaults; const client = axios.create(config); await client.post('/', event);",
      filename: TS,
      errors: [error],
    },
    { code: 'axios.create({ baseURL: hook.url, timeout: 5000 } as CreateAxiosDefaults);', filename: TS, errors: [error] },
    { code: "https.get('https://api.example.com/x', { hostname: req.query.h } as https.RequestOptions);", filename: TS, errors: [host] },
    { code: 'const opts = { hostname: req.query.h } satisfies https.RequestOptions; https.request(url, opts);', filename: TS, errors: [host, error] },
    { code: "tls.connect(443, 'api.example.com', { host: req.query.h } as tls.ConnectionOptions);", filename: TS, errors: [host] },
    { code: "axios.get('/x', { baseURL: req.query.b } as any);", filename: TS, errors: [error] },
    { code: "const opts = { hostname: 'api.example.com', port: req.query.p }; https.get(opts!);", filename: TS, errors: [option] },
    // An axios.create config the rule cannot read is reported, like a first-argument URL.
    { code: 'axios.create(req.body);', filename: TS, errors: [option] },
    { code: 'function mk(cfg) { return axios.create(cfg); }', filename: TS, errors: [option] },
    { code: 'axios.create(c ? { baseURL: x } : {});', filename: TS, errors: [option] },
    // Trailing options the requester supplies whole, or partly through Object.assign or a branch.
    { code: "https.get('https://api.example.com/x', req.body);", filename: TS, errors: [option] },
    { code: "axios.get('https://api.example.com/x', req.body);", filename: TS, errors: [option] },
    { code: "axios.post('https://api.example.com/x', data, req.body.config);", filename: TS, errors: [option] },
    { code: "const opts = req.body.options; https.request('https://api.example.com/x', opts);", filename: TS, errors: [option] },
    { code: "const { options } = req.body; https.get('https://api.example.com/x', options);", filename: TS, errors: [option] },
    { code: "https.get('https://api.example.com/x', req.body.options ?? {});", filename: TS, errors: [option] },
    {
      code: "const fixed = { timeout: 1000 }; https.get('https://api.example.com/x', Object.assign({}, fixed, req.body));",
      filename: TS,
      errors: [option],
    },
    {
      code: "function get(overrides) { return https.get('https://api.example.com/x', Object.assign({}, overrides)); }",
      filename: TS,
      errors: [option],
    },
    { code: "https.get('https://api.example.com/x', Object.assign({}, { hostname: req.query.h }));", filename: TS, errors: [host] },
    { code: "https.get('https://api.example.com/x', cond ? { hostname: x } : {});", filename: TS, errors: [host] },
    { code: "https.get('https://api.example.com/x', cond ? {} : req.body);", filename: TS, errors: [option] },
    { code: "tls.connect(443, 'api.example.com', req.body);", filename: TS, errors: [option] },
    // axios defaults set by a computed key or Object.assign, or replaced whole.
    { code: "axios.defaults['baseURL'] = req.query.base;", filename: TS, errors: [error] },
    { code: 'axios.defaults[`baseURL`] = req.query.base;', filename: TS, errors: [error] },
    { code: 'Object.assign(axios.defaults, { baseURL: req.query.base });', filename: TS, errors: [error] },
    { code: 'function setup(cfg) { Object.assign(axios.defaults, cfg); }', filename: TS, errors: [option] },
    { code: 'axios.defaults.proxy = { host: req.query.h, port: 8080 };', filename: TS, errors: [host] },
    { code: 'axios.defaults[key] = value;', filename: TS, errors: [option] },
    { code: 'axios.defaults = req.body;', filename: TS, errors: [option] },
    {
      code: "const api = axios.create({ baseURL: 'https://api.example.com' }); api.defaults['baseURL'] = req.query.base;",
      filename: TS,
      errors: [error],
    },
    // A const is author-written only when what it holds is.
    { code: "const a = req.body.agent; http.get({ hostname: 'api.example.com', agent: a });", filename: TS, errors: [option] },
    { code: "const l = makeLookup(req.query.dns); http.get({ hostname: 'api.example.com', lookup: l });", filename: TS, errors: [option] },
    // A prototype the rule cannot read supplies every key the object does not set.
    { code: 'net.connect({ __proto__: req.body, port: 80 });', filename: TS, errors: [option] },
    { code: "net.connect({ '__proto__': req.body, port: 80 });", filename: TS, errors: [option] },
    { code: "http.get({ __proto__: opts, path: '/x' });", filename: TS, errors: [option] },
    { code: 'net.connect({ __proto__: { host: req.query.h }, port: 80 });', filename: TS, errors: [host] },
    // The axios form methods.
    { code: 'axios.postForm(req.query.url, form);', filename: TS, errors: [error] },
    { code: 'axios.putForm(target, form);', filename: TS, errors: [error] },
    { code: "axios.patchForm('/x', form, { baseURL: req.query.base });", filename: TS, errors: [error] },
    // undici clients built on a runtime origin.
    { code: "import { Client } from 'undici'; new Client(req.query.origin);", filename: TS, errors: [error] },
    { code: "import { Pool } from 'undici'; const pool = new Pool(`https://${host}`);", filename: TS, errors: [error] },
    { code: "import * as undici from 'undici'; new undici.Client(target);", filename: TS, errors: [error] },
    { code: "const { Pool } = require('undici'); new Pool(target);", filename: TS, errors: [error] },
    // An exported const options object can be changed by an importing module.
    { code: "export const opts = { hostname: 'api.example.com' }; https.get(opts);", filename: TS, errors: [error] },
    { code: "export const opts = { hostname: 'api.example.com' } as const; https.get(opts);", filename: TS, errors: [error] },
    { code: "const opts = { hostname: 'api.example.com' }; export { opts }; https.get(opts);", filename: TS, errors: [error] },
    { code: "export const BASE = { hostname: 'api.example.com' }; https.get({ ...BASE, path: '/x' });", filename: TS, errors: [option] },
    { code: "export const cfg = { timeout: 1000 }; https.get('https://api.example.com/x', cfg);", filename: TS, errors: [option] },
    { code: "export const config = { baseURL: 'https://api.example.com' }; axios.create(config);", filename: TS, errors: [option] },
    // axios behind a type wrapper or an alias.
    { code: '(axios as any).get(req.query.u);', filename: TS, errors: [error] },
    { code: '(<any>axios).post(req.query.u, body);', filename: TS, errors: [error] },
    { code: 'const ax = axios; ax.get(req.query.u);', filename: TS, errors: [error] },
    { code: 'const ax = axios; ax({ url: target });', filename: TS, errors: [error] },
    { code: 'const ax = axios as AxiosStatic; ax.defaults.baseURL = req.query.base;', filename: TS, errors: [error] },
    {
      code: "const api = axios.create({ baseURL: 'https://api.example.com' }); const client = api; client.get(req.query.u);",
      filename: TS,
      errors: [error],
    },
    // Both opt-ins are off by default.
    { code: 'fetch(new URL(`r/${name}.json`, config.registryUrl));', filename: TS, errors: [error] },
    { code: 'fetch(`http://127.0.0.1:${port}/health`);', filename: TS, errors: [error] },
    { code: 'fetch(`http://localhost:${Number(port)}/health`);', filename: TS, errors: [error] },
    // A trusted source is an origin: what follows it must still close the authority.
    {
      code: 'fetch(`${config.registryUrl}${path}`);',
      filename: TS,
      options: [{ trustedSources: ['config.registryUrl'] }],
      errors: [error],
    },
    {
      code: 'fetch(new URL(path, config.registryUrl));',
      filename: TS,
      options: [{ trustedSources: ['config.registryUrl'] }],
      errors: [error],
    },
    // Only the entry and properties read off it, by name or literal key.
    {
      code: 'fetch(config.mirrors[req.query.i]); fetch(configs.registryUrl); fetch(getConfig().registryUrl); fetch(config.registryUrl.replace(a, b));',
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, error, error, error],
    },
    {
      code: 'fetch(config.registry);',
      filename: TS,
      options: [{ trustedSources: ['config.registryUrl'] }],
      errors: [error],
    },
    {
      code: 'https.get({ hostname: req.query.h }); https.get({ hostname: config[key] });',
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [host, host],
    },
    // A runtime value is never trusted for looking like loopback.
    {
      code: [
        'fetch(target);',
        "const t = 'http://localhost:' + port; fetch(t);",
        'fetch(`http://${host}:${Number(port)}/x`);',
        'fetch(`http://localhost:${port}/x`);',
        'fetch(`http://localhost:${String(port)}/x`);',
        'fetch(`http://localhost:${a + b}/x`);',
        'fetch(`http://localhost:${Number(port)}${path}`);',
        'fetch(`http://localhost:${Number(port)}@evil.com/x`);',
        'fetch(`http://localhost.evil.com:${Number(port)}/x`);',
        'fetch(`http://127.0.0.2:${Number(port)}/x`);',
        'fetch(`http://localhost${Number(port)}/x`);',
        'fetch(`http://user@localhost:${Number(port)}/x`);',
        'function f(Number) { return fetch(`http://localhost:${Number(port)}/x`); }',
        'fetch(`http://localhost:${Math.constructor(port)}/x`);',
        'fetch(`http://localhost:${Math.random.call(port)}/x`);',
      ].join('\n'),
      filename: TS,
      options: [{ allowLoopback: true }],
      errors: Array.from({ length: 15 }, () => error),
    },
    // Object.assign copies shallowly: a nested object stays shared with the copy.
    {
      code: "const cfg = { proxy: { host: 'p.example.com', port: 8080 } }; const t = Object.assign({}, cfg); t.proxy.host = req.query.h; axios.get('/x', cfg);",
      filename: TS,
      errors: [option],
    },
    {
      code: "import { Agent } from 'node:https'; const o = { hostname: 'api.example.com', agent: new Agent() }; Object.assign({}, o).agent.options.host = req.query.h; https.get(o);",
      filename: TS,
      errors: [error],
    },
    {
      code: "const cfg = { headers: { host: 'api.example.com' } }; const t = {}; https.get('https://api.example.com/x', Object.assign(t, cfg)); t.headers.host = req.query.h;",
      filename: TS,
      errors: [option, option],
    },
    // A trusted source name is matched by binding: request data, a parameter or a write keeps the report.
    ...[
      'const config = req.body;',
      'const { config } = req.body;',
      'let config = load(); config = req.body;',
      'config.url = req.query.u; config.host = req.query.h;',
      'Object.assign(config, req.body);',
      'Object.assign(config.http, req.body);',
      '({ url: config.url, host: config.host } = req.query);',
      'config.mirrors.push(req.query.u);',
      'delete config.url;',
      'const config = req.body.settings ?? {};',
    ].map((setup) => ({
      code: `${setup} fetch(config.url); https.get({ hostname: config.host, path: '/x' });`,
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    })),
    {
      code: "function handler(config) { fetch(config.url); https.get({ hostname: config.host, path: '/x' }); }",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    },
    {
      code: "app.post('/x', async (req, res) => { const config = req.body; await fetch(config.url); https.get({ hostname: config.host, path: '/x' }); });",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    },
    {
      code: "app.post('/x', async ({ body: config }, res) => { await fetch(config.url); });",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error],
    },
    {
      code: "class Cli { run() { fetch(this.config.url); fetch(getConfig().url); } }",
      filename: TS,
      options: [{ trustedSources: ['this.config', 'getConfig()'] }],
      errors: [error, error],
    },
    // A host regex over a public suffix: anyone can register a name under it.
    ...['vercel\\.app', 'github\\.io', 'netlify\\.app', 'pages\\.dev', 'co\\.uk'].map((suffix) => ({
      code: `async function h(src: string) { if (!/^[a-z0-9-]+\\.${suffix}$/.test(new URL(src).hostname)) return; await fetch(src); }`,
      filename: TS,
      errors: [error],
    })),
    // A relative prefix made only of scheme characters can still grow into a scheme.
    { code: 'fetch(`h${x}`);', filename: TS, errors: [error] },
    { code: 'fetch(`java${x}`);', filename: TS, errors: [error] },
    { code: "fetch('h' + x);", filename: TS, errors: [error] },
  ],
});

// Relative prefixes no scheme that leaves the origin starts with.
ruleTester.run('no-user-controlled-fetch-url: relative scheme-shaped prefixes', noUserControlledFetchUrlRule, {
  valid: [
    { code: 'fetch(`api${x}`);', filename: TS },
    { code: "fetch('users' + id);", filename: TS },
    { code: 'fetch(`page.html${x}`);', filename: TS },
  ],
  invalid: [
    { code: 'fetch(`dat${x}`);', filename: TS, errors: [error] },
    { code: 'fetch(`Ws${x}`);', filename: TS, errors: [error] },
    { code: "fetch('fil' + x);", filename: TS, errors: [error] },
    { code: 'fetch(`HTTPS${x}`);', filename: TS, errors: [error] },
  ],
});

// A trusted source copied into another binding, handed to a call that may
// change it, written through a global object, or read off a response.
ruleTester.run('no-user-controlled-fetch-url: trusted sources that leave', noUserControlledFetchUrlRule, {
  valid: [
    // Copies into local bindings that are only read.
    ...[
      'const url = config.url; fetch(url);',
      'const { verbose, mirrors } = config; if (verbose) console.log(mirrors[0]);',
      'const c = config; const t = `${c.url}/x`;',
      'for (const m of config.mirrors) console.log(m.url);',
      'config.mirrors.forEach((m) => console.log(m.url.trim()));',
      'let c; c = config; if (c.verbose) {}',
    ].map((setup) => ({
      code: `${setup} fetch(config.url); https.get({ hostname: config.host, path: '/x' });`,
      filename: TS,
      options: [{ trustedSources: ['config'] }],
    })),
    // Known readers, string building, tests and the rule's own calls.
    {
      code: "console.log(config); String(config.port); JSON.stringify(config); Object.keys(config); new URL(config.base); if (config.verbose && typeof config === 'object') {} const t = `${config.url}`; fetch(config.url); axios.create({ baseURL: config.url }); https.get({ hostname: config.host, path: '/x' });",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
    },
    // A global with a read through globalThis only.
    {
      code: 'log(globalThis.config.url.trim()); fetch(config.url);',
      filename: TS,
      options: [{ trustedSources: ['config'] }],
    },
  ],
  invalid: [
    ...[
      // Copied into another binding, then written through it.
      'const c = config; c.url = req.query.u;',
      'const { sub } = config; sub.url = x;',
      'const m = config.mirrors; m[0] = x;',
      'let c; c = config; c.url = x;',
      'const { ...rest } = config; rest.http.url = x;',
      'const copy = { ...config }; copy.http.url = x;',
      'const box = { config }; box.config.url = x;',
      'const list = [config]; list[0].url = x;',
      'for (const m of config.mirrors) m.url = x;',
      'config.mirrors.forEach((m) => { m.url = x; });',
      'config.mirrors.at(0).url = x;',
      'config.servers.get(k).url = x;',
      'export const c = config;',
      // Handed to a call that may change it.
      'mutate(config, req.body);',
      '_.merge(config, req.body);',
      'merge(config, req.body);',
      "_.set(config, 'url', x);",
      "const { defineProperty } = Object; defineProperty(config, 'url', { value: x });",
      'register(config.http);',
      'Object.assign({}, config);',
      'helpers.push(config);',
      'setup(...[config]);',
      'tag`${config}`;',
      'const String = (o) => { o.url = x; }; String(config);',
      // Left through a return or a throw.
      'function get() { return config; }',
      'const get = () => config.http;',
      // A write through a global object.
      'globalThis.config = req.body;',
      "window['config'] = req.body;",
      'globalThis.config.url = x;',
      'Object.assign(globalThis.config, req.body);',
    ].map((setup) => ({
      code: `${setup} fetch(config.url); https.get({ hostname: config.host, path: '/x' });`,
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    })),
    // A source read off the response, which earlier middleware filled.
    {
      code: "app.get('/x', (req, res) => { const config = res.locals.cfg; fetch(config.url); https.get({ hostname: config.host, path: '/x' }); });",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    },
    {
      code: "app.get('/x', (rq, rs) => { const config = rs.locals.cfg; fetch(config.url); });",
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error],
    },
    // Without the option nothing is trusted, copies or not.
    {
      code: "const url = config.url; fetch(url); fetch(config.url); https.get({ hostname: config.host, path: '/x' });",
      filename: TS,
      errors: [error, error, host],
    },
  ],
});

// `Object.values` and `Object.entries` hand out the objects under the source,
// a `JSON.stringify` replacer function is handed every value, and an export
// list lets the source go.
ruleTester.run('no-user-controlled-fetch-url: trusted source readers', noUserControlledFetchUrlRule, {
  valid: [
    ...[
      'Object.values(config.mirrors).forEach((m) => console.log(m.url));',
      'for (const [k, m] of Object.entries(config.mirrors)) console.log(k, m.url);',
      'const first = Object.values(config)[0]; log(first.url.trim());',
      "JSON.stringify(config); JSON.stringify(config, null, 2); JSON.stringify(config, ['url']); JSON.stringify(config, undefined, 2);",
      'Object.keys(config).forEach((k) => console.log(k));',
    ].map((setup) => ({
      code: `${setup} fetch(config.url); https.get({ hostname: config.host, path: '/x' });`,
      filename: TS,
      options: [{ trustedSources: ['config'] }],
    })),
  ],
  invalid: [
    ...[
      'Object.values(config.mirrors).forEach((m) => { m.url = req.query.u; });',
      'for (const [k, m] of Object.entries(config.mirrors)) m.url = req.query.u;',
      'Object.values(config)[0][0].url = req.query.u;',
      'const parts = Object.entries(config); parts[0][1].url = x;',
      'mutate(Object.values(config));',
      'JSON.stringify(config, (k, v) => { v.url = x; return v; });',
      'JSON.stringify(config, replacer);',
      'export { config };',
      'export { config as settings };',
    ].map((setup) => ({
      code: `${setup} fetch(config.url); https.get({ hostname: config.host, path: '/x' });`,
      filename: TS,
      options: [{ trustedSources: ['config'] }],
      errors: [error, host],
    })),
  ],
});

// Relative text that can still grow into a protocol handler scheme.
ruleTester.run('no-user-controlled-fetch-url: protocol handler schemes', noUserControlledFetchUrlRule, {
  valid: [{ code: 'fetch(`docs${x}`);', filename: TS }],
  invalid: [
    { code: 'fetch(`ms-${x}`);', filename: TS, errors: [error] },
    { code: 'fetch(`m${x}`);', filename: TS, errors: [error] },
    { code: "fetch('se' + x);", filename: TS, errors: [error] },
    { code: 'fetch(`VSCODE${x}`);', filename: TS, errors: [error] },
  ],
});
