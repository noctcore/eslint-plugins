# `noctcore-code-quality/no-real-network-in-unit-tests`

> Unit tests must not perform real network I/O.

Ported from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Why

A unit test that calls `fetch` or `axios` for real depends on a server, a port, DNS and the network
being up. It is slow, flaky and order-dependent, and it hides the fact that the code under test has
no seam for a test double. Mock the client, or move the test to an integration suite where real I/O
is the point.

## What it flags

In a unit test file (a path ending in one of `testFileSuffixes`, and not containing any
`integrationMarkers`):

- a call to a `networkCallees` global: `fetch(...)`, `globalThis.fetch(...)`, `window.fetch(...)`;
- a call to an `httpClients` client or its request methods: `axios(...)`, `axios.get(...)`,
  `axios.post(...)`, and `put` / `patch` / `delete` / `head` / `options` / `request`.

It does not flag:

- a locally declared double (`const fetch = vi.fn()`); an imported `fetch` is still reported;
- a global the file stubs (`vi.stubGlobal('fetch', ...)`, `jest.spyOn(globalThis, 'fetch')`,
  `globalThis.fetch = vi.fn()`);
- a client whose module the file mocks (`vi.mock('axios')`, `jest.mock('node-fetch')`);
- a method that only shares a name (`repository.fetch(1)`, `store.get('k')`).

```ts
// Bad: src/api/client.test.ts
it('loads the profile', async () => {
  const res = await fetch('https://api.example.com/me');
  expect(res.status).toBe(200);
});
```

```ts
// Good: src/api/client.test.ts
it('loads the profile', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":1}')));
  expect(await loadProfile()).toEqual({ id: 1 });
});

// Good: src/api/client.integration.test.ts runs against a real server.
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `testFileSuffixes` | `string[]` | `.test` / `.spec` with `.ts`, `.tsx`, `.js`, `.jsx` | A file is a unit test when its path ends with one of these. |
| `integrationMarkers` | `string[]` | `.integration.test.`, `.integration.spec.`, `.e2e.test.`, `.e2e.spec.`, `.e2e-spec.`, `/integration/`, `/e2e/` | A test file whose path, relative to the ESLint working directory, contains one of these is skipped. |
| `networkCallees` | `string[]` | `["fetch"]` | Global functions that perform network I/O. |
| `httpClients` | `string[]` | `["axios"]` | HTTP clients whose direct call or request methods perform network I/O. |

```js
'noctcore-code-quality/no-real-network-in-unit-tests': ['error', {
  integrationMarkers: ['.integration.', '/e2e/', '.live.'],
  httpClients: ['axios', 'ky'],
}]
```

## Limitations

The rule sees calls in the test file only, not network calls made by the code under test. A request
intercepted by a setup-file mock server (for example MSW) is still reported when the test file itself
calls `fetch`; add that file's suffix to `integrationMarkers` or disable the rule for it.

## When not to use it

If your unit tests deliberately run against a local server started in-process, name those files with
an integration marker instead of turning the rule off.
