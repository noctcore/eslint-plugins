# `noctcore-react/component-props-naming`

> A function component's first-param props type should be named `<Component>Props`.

🔧 This rule is automatically fixable (when the rename is safe).

## Why

Naming a component's props type `<Component>Props` keeps the contract discoverable — `ButtonProps`
sits right next to `Button` — and is the convention a dozen sibling rules key off. A component whose
props type is named `Props`, `IProps`, or something unrelated hides that link.

## What it flags

A **PascalCase, JSX-returning** function component whose first parameter is annotated with a plain
named type that is not `<Component>Props`:

```tsx
// ✗ props type is `Props`, component is `Button`
function Button(props: Props) {
  return <button {...props} />;
}

// ✓
function Button(props: ButtonProps) {
  return <button {...props} />;
}
```

Precision guardrails (all syntactic — no type information):

- only PascalCase functions that actually return JSX count as components, so factories and hooks are
  never touched;
- the first-param annotation must be a bare type reference with no type arguments, so wrappers like
  `PropsWithChildren<Props>` and `React.FC` argument shapes are left alone.

## Autofix

The fix renames the type declaration and every in-file reference to `<Component>Props`. It runs
**only** when it is safe:

- the type is declared in this file (not imported), and
- the type is **not** exported (renaming an exported type would break other files' imports), and
- the target name `<Component>Props` is not already taken, and
- no other component shares the same props type.

When any of these does not hold, the rule reports without a fix.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requireExported` | `boolean` | `false` | When `true`, only exported components are checked; internal/local components are ignored. |

```js
'noctcore-react/component-props-naming': ['error', { requireExported: true }]
```

## When not to use it

If you deliberately share one props type across several components, or you do not follow the
`*Props` convention, this rule will be noisy — disable it or scope it with `requireExported`.
