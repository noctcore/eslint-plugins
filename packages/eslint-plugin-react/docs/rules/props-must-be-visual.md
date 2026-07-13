# `noctcore-react/props-must-be-visual`

> Component props describe what to render — not who is acting or what secret to use.

## Why

Component props should describe visual concerns. Names that look like auth/business identity
(`userId`, `currentUser`, `sessionId`) or secrets at rest (`token`, `jwt`, `secret`, `apiKey`) leak
identity and credentials into the presentation layer. Pass a derived/display value instead, and read
identity or secrets in the hook. A live `password` typed into a form is a legitimate visual input (a
strength meter must receive it), so it is intentionally **not** on the denylist.

## What it flags

Members of any `*Props` interface or object type-literal alias whose name matches a `denyPropNames`
entry. Entries are matched as **case-insensitive regular expressions**, so the defaults mix anchored
names (`^userId$`) and substrings (`token` matches `resetToken`). The rule keys off the `*Props`
naming convention and is layout-independent.

```ts
// ✗ identity / credential props
interface LoginFormProps {
  userId: string;
  resetToken: string;
}

// ✓ visual props (and a live password input is allowed)
interface LoginFormProps {
  label: string;
  password: string;
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `denyPropNames` | `string[]` | `['^userId$', '^userIds$', '^currentUser', '^sessionId$', 'token', 'jwt', 'secret', 'apiKey', 'credential']` | Case-insensitive regex patterns for disallowed prop names. |

A malformed pattern raises an actionable config error naming the bad entry, rather than an opaque
`SyntaxError` that aborts the whole lint run.

```js
'noctcore-react/props-must-be-visual': ['error', { denyPropNames: ['^userId$', 'token', '^ssn$'] }]
```

## When not to use it

If your components legitimately accept identity props (e.g. a low-level primitive that genuinely
needs a `userId`), narrow `denyPropNames` or disable the rule for those files.
