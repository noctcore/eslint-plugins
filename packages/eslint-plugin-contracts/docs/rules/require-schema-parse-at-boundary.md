# `noctcore-contracts/require-schema-parse-at-boundary`

> Parse external boundary data at runtime — don't assert its shape with `as T`.

## Why

External data — a fetch body, a `JSON.parse` result, a message-event payload — has whatever shape the
sender actually sent, which TypeScript never sees. Asserting it with `as User` is a compile-time
promise the runtime never checks: a field the server dropped is now `undefined` masquerading as a
`string`, and the corruption surfaces far from the boundary. Parsing with a runtime schema
(zod/valibot) validates the shape at the edge and fails loudly there:

```ts
const user = UserSchema.parse(await res.json()); // validated
```

## What it flags

This is a **conservative syntactic slice** of a concept that is fully general only with type
information. It flags a cast applied **directly** to a call site that is unmistakably a boundary read:

```ts
// ✗
const user = JSON.parse(raw) as User;
const users = JSON.parse(raw) as User[];
const user = (await res.json()) as User;

// ✓
const user = UserSchema.parse(JSON.parse(raw));
const user = UserSchema.parse(await res.json());
const data = JSON.parse(raw) as unknown; // safe widening, not a shape claim
```

Only these forms are flagged: `JSON.parse(...) as T` and `(await <expr>.json()) as T`, and only when
the cast target is a shape claim (a named type or array — `as User`, `as User[]`). Casts to `unknown`,
`any`, or `const` are the safe/neutral forms and are never flagged. A boundary value stored in a
variable and cast later is out of syntactic reach — enforce that with a type-aware setup.

## Options

None.

## When not to use it

If you deliberately trust certain boundaries (an internal service with a shared type package) or have
a type-aware lint pass that supersedes this heuristic, leave this rule off. It ships `off` in the
`recommended` preset for that reason — enable it where the boundary is genuinely untrusted.
