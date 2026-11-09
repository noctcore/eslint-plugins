# `noctcore-react/component-props-naming`

> A function component's first-param props type should be named `<Component>Props`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 🔧 Fixable with `--fix` · 💭 Type information: not needed
<!-- end generated rule header -->

🔧 This rule is automatically fixable (when the rename is safe).

## Why

Naming a component's props type `<Component>Props` keeps the contract discoverable — `ButtonProps`
sits right next to `Button` — and is the convention a dozen sibling rules key off. A component whose
props type is named `Props`, `IProps`, or something unrelated hides that link.

## What it flags

A **PascalCase, JSX-returning** function component whose first parameter is annotated with a plain
named type, declared in the same file, that is not `<Component>Props` (or the name the `pattern`
option builds):

```tsx bad
// props type is `Props`, component is `Button`
interface Props { label: string }
function Button(props: Props) {
  return <button {...props} />;
}
```

```tsx good
interface ButtonProps { label: string }
function Button(props: ButtonProps) {
  return <button {...props} />;
}
```

### Autofix

The fix renames the type declaration and every in-file reference to `<Component>Props`. It runs
**only** when it is safe:

- the type is declared once in this file, and
- the type is **not** exported, by its declaration or a later `export { Props }` /
  `export type { Props }` (renaming an exported type would break other files' imports), and
- every other mention of the name is a plain type reference: an `interface Wide extends Props`, an
  `implements Props` or a re-export would be left pointing at nothing, so any of them refuses the
  fix, and
- the target name `<Component>Props` is not already taken, and
- no other component shares the same props type.

When any of these does not hold, the rule reports without a fix.

## What it does not flag

Precision guardrails (all syntactic — no type information):

- only PascalCase functions that actually return JSX count as components, so factories and hooks are
  never touched;
- the first-param annotation must be a bare type reference with no type arguments, so wrappers like
  `PropsWithChildren<Props>` and `React.FC` argument shapes are left alone;
- untyped props (`function Thing(props)`) have no name to check;
- a props type that is not declared in this file (imported, global, a library type such as
  `IconProps` or a design-system `ButtonProps`) is correct as written and is not reported;
- with `requireExported: true`, internal components are skipped.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requireExported` | `boolean` | `false` | When `true`, only exported components are checked; internal/local components are ignored. |
| `pattern` | `string` | `'{Component}Props'` | The expected type name, with `{Component}` standing for the component name. `'I{Component}Props'` fits a codebase that prefixes interfaces with `I`. |

```js
'noctcore-react/component-props-naming': ['error', { requireExported: true }]
// with an interface-prefix rule:
'noctcore-react/component-props-naming': ['error', { pattern: 'I{Component}Props' }]
```

## When not to use it

If you deliberately share one props type across several components, or you do not follow the
`*Props` convention, this rule will be noisy — disable it or scope it with `requireExported`.
