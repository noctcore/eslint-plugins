# `noctcore-code-quality/no-vacuous-expect`

> A test must assert behaviour that a real regression would break.

Ported from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Why

Some assertions pass for almost any implementation. `expect(typeof handler).toBe('function')` proves
a binding exists. `expect(true).toBe(true)` cannot fail. A test whose only assertion is
`toBeDefined()` or `toBeTruthy()` stays green when the function returns the wrong object, the wrong
string or the wrong number. These tests add to the count and protect nothing.

The rule matches on method names, not on a runner import, so it covers Jest, Vitest and Bun alike.

## What it flags

- `typeofExpect`: `expect(typeof x).toBe('<typeof result>')`, also with `toEqual`, `toStrictEqual`
  and `.not`.
- `tautologyExpect`: `expect(<literal>).toBe(<same literal>)`, also with `toEqual` / `toStrictEqual`.
- `soleWeakExpect`: a test (`it` / `test`, including `.concurrent`, `.each` and other modifiers)
  whose only assertion is a weak matcher.

A test counts every `expect(...)` matcher plus any call matching `assertionCallees`, so a weak
`expect` next to `assert.equal(...)`, `expectValidUser(...)` or supertest's `.expect(200)` is fine.

```ts bad filename=src/token.test.ts reports=3
it('should be defined', () => {
  expect(service).toBeDefined();
});

it('returns a token', () => {
  expect(typeof issueToken()).toBe('string');
});

it('works', () => {
  expect(true).toBe(true);
});
```

```ts good filename=src/token.test.ts
it('issues a signed token for the user', () => {
  const token = issueToken({ userId: 'u-1' });
  expect(verify(token)).toEqual({ userId: 'u-1' });
});

it('creates the user', () => {
  const user = create({ name: 'ada' });
  expect(user).toBeDefined();
  expect(user.name).toBe('ada');
});

it('clears the key', () => {
  cache.delete('k');
  expect(cache.get('k')).toBeUndefined(); // a specific absence, not a weak check
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `weakMatchers` | `string[]` | `["toBeDefined", "toBeTruthy", "toBeFalsy", "not.toBeUndefined"]` | Matchers that cannot carry a test alone. Prefix `not.` for the negated form. |
| `assertionCallees` | `string[]` (regex sources) | `["^assert", "^expect\\w", "\\.expect$"]` | Calls that also count as an assertion. Matched against `name`, `obj.name` (member on an identifier) or `.name` (any other member). |

`toBeUndefined`, `toBeNull` and `not.toBeNull` are not weak by default: each pins one specific
value, and `expect(container.querySelector('nav')).not.toBeNull()` is a real presence check.

```js
// Treat toBeUndefined as weak too, and count a project helper as an assertion.
'noctcore-code-quality/no-vacuous-expect': ['error', {
  weakMatchers: ['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeUndefined'],
  assertionCallees: ['^assert', '^expect\\w', '\\.expect$', '^verifySnapshot$'],
}]
```

## Limitations

Assertions are counted syntactically inside the test callback. An assertion hidden in a helper whose
name does not match `assertionCallees` is not seen. A sole `toBeTruthy()` on a Testing Library
`getBy*` query is reported even though the query itself throws when the element is missing; assert
with a matcher that states the intent instead.

## When not to use it

In a smoke suite whose only purpose is to prove modules load.
