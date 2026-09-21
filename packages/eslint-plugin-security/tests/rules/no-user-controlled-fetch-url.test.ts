import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUserControlledFetchUrlRule } from '../../src/rules/no-user-controlled-fetch-url';

const TS = 'client.ts';
const error = { messageId: 'userControlledFetchUrl' } as const;

ruleTester.run('no-user-controlled-fetch-url', noUserControlledFetchUrlRule, {
  valid: [
    // Plain literals and no-interpolation templates.
    { code: `fetch('https://api.example.com/todos');`, filename: TS },
    { code: 'fetch(`https://api.example.com/todos`);', filename: TS },
    // Relative, same origin: the id can only move the path.
    { code: 'fetch(`/api/todos/${id}`);', filename: TS },
    { code: 'fetch(`api/todos/${id}`);', filename: TS },
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
    { code: 'http.get(url);', filename: TS },
    // A method *definition* named fetch is not a call.
    { code: 'const client = { fetch(url: unknown) { return url; } };', filename: TS },
    // A numeric segment is author text too.
    { code: `fetch('https://api.example.com/v' + 2 + '/todos');`, filename: TS },
  ],
  invalid: [
    // A bare runtime value.
    { code: 'fetch(url);', filename: TS, errors: [error] },
    { code: 'axios.post(target, body);', filename: TS, errors: [error] },
    // Runtime host position.
    { code: 'fetch(`https://${host}/todos`);', filename: TS, errors: [error] },
    // Protocol-relative runtime host.
    { code: 'fetch(`//${host}/todos`);', filename: TS, errors: [error] },
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
  ],
});
