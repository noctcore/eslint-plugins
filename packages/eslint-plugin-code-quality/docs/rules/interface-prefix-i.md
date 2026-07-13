# `noctcore-code-quality/interface-prefix-i`

> Interface names must be `I` + an uppercase letter (`IUserProfile`). **Opinionated — not in `recommended`.**

## Why

An `I`-prefixed interface reads as an interface at a glance and never collides with a value of the same
name. This is a house-style naming convention, not a correctness rule — some teams find the prefix
noisy. It is therefore **excluded from the `recommended` preset**; enable it explicitly if your team
wants it.

## What it flags

A `TSInterfaceDeclaration` whose name is **not** `I` followed by an uppercase letter
(`/^I[A-Z]/`). `Input` fails (the letter after `I` is lowercase); `IUserProfile` passes.

Interfaces inside an ambient `declare module` / `declare global` block are **exempt** — their names are
dictated by the module being augmented (`Register`, `Window`).

Report-only: a rename touches every reference, which a single-file fixer cannot do safely.

```ts
// ✗ interface UserProfile { id: string; }
// ✗ interface Input { value: string; }

// ✓ interface IUserProfile { id: string; }
// ✓ declare global { interface Window { electron: unknown; } }  // augmentation
```

## Options

None.

## Enabling it

Not part of `recommended`. Turn it on directly:

```js
'noctcore-code-quality/interface-prefix-i': 'error'
```

## When not to use it

If your codebase does not use the `I` interface-prefix convention (most don't) — leave it off.
