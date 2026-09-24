# `noctcore-code-quality/interface-prefix-i`

> Interface names must be `I` + an uppercase letter (`IUserProfile`). **Opinionated — not in `recommended`.**

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

An `I`-prefixed interface reads as an interface at a glance and never collides with a value of the same
name. This is a house-style naming convention, not a correctness rule — some teams find the prefix
noisy. It is therefore **excluded from the `recommended` preset**; enable it explicitly if your team
wants it.

### Enabling it

Not part of `recommended`. Turn it on directly:

```js
'noctcore-code-quality/interface-prefix-i': 'error'
```

## What it flags

A `TSInterfaceDeclaration` whose name is **not** `I` followed by an uppercase letter
(`/^I[A-Z]/`). `Input` fails (the letter after `I` is lowercase); `IUserProfile` passes.

Report-only: a rename touches every reference, which a single-file fixer cannot do safely.

```ts bad reports=2
interface UserProfile { id: string; }
interface Input { value: string; }
```

```ts good
interface IUserProfile { id: string; }
declare global { interface Window { electron: unknown; } } // augmentation
```

## What it does not flag

- Interfaces inside an ambient `declare module` / `declare global` block — their names are
  dictated by the module being augmented (`Register`, `Window`).
- `type` aliases: only `interface` declarations are checked.

## When not to use it

If your codebase does not use the `I` interface-prefix convention (most don't) — leave it off.
