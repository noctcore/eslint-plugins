# `noctcore-contracts/fetch-must-check-ok`

> A fetch response must be checked with `.ok` or a status comparison before `.json()` parses its body.

Ported from tsforge's `typescript-core/fetch-must-check-ok` (MIT).

## Why

`fetch` rejects only on a network failure. A 4xx or 5xx resolves normally, and `.json()` then parses
the error body as if it were data. Wrapping the call in `try` does not help on its own: the code
fails closed, but every bad response surfaces as a parse or schema error that says nothing about the
status the server actually sent. Check the response first, and the failure is named where it happens.

## What it flags

A `.json()` read on a response bound from a configured fetch callee when no check governs it.

```ts
// ✗ no check at all
export async function loadUser(id: string) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}

// ✗ the check comes after the body is already parsed
const data = await res.json();
if (!res.ok) throw new Error('failed');

// ✗ a single-code guard lets every other error through
if (res.status === 404) return null;
return res.json();

// ✗ `||` runs the parse exactly on the failure path
return res.ok || res.json();
```

```ts
// ✓ guard clause
export async function loadUser(id: string) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) {
    throw new Error(`user request failed: ${res.status}`);
  }
  return res.json();
}

// ✓ the parse sits in the branch the check permits
return res.ok ? res.json() : null;

// ✓ a status split at the success/error boundary, or a switch on success codes
if (res.status >= 400) return null;
switch (res.status) { case 200: case 201: return res.json(); default: return null; }

// ✓ an assertion helper (`assert`, `invariant`, `ensure*`, `expect*`)
invariant(res.ok, 'user request failed');
return res.json();
```

Three response shapes are tracked: `const res = await fetch(...)` then `res.json()` in the same block,
`fetch(...).then((res) => ...)`, and the unbound `(await fetch(...)).json()`, which is always reported.
Aliases work (`const ok = res.ok; if (!ok) throw ...`). A bare `if (res.status)` or
`typeof res.status === 'number'` is not a check: both are true for a 500.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchFunctions` | `string[]` | `['fetch']` | Callees that return a `Response`: a bare name or a dotted path. |

List every name you want tracked, including `fetch` itself:

```js
'noctcore-contracts/fetch-must-check-ok': ['error', {
  fetchFunctions: ['fetch', 'globalThis.fetch', 'fetchWithRetry'],
}]
```

## Limits

Purely syntactic, no type information. A response assigned later (`let res; res = await fetch(...)`),
passed to another function, or returned from a wrapper that is not in `fetchFunctions` is not tracked.
A nested function that reuses the response's name is treated as the same binding. Clients whose
`.json()` already throws on a bad status (ky, for example) do not belong in `fetchFunctions`.
