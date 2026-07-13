# `noctcore-react/no-jsx-in-hooks`

> A `use*`-named function must not return JSX — that is a component wearing a hook costume.

## Why

Hooks return data and handlers; components return markup. A `use*`-named function that returns JSX
is a component mislabelled as a hook — it breaks the rules-of-hooks mental model (you would have to
render it as `<useThing />`) and quietly defeats every convention keyed off the `use*` prefix.
Rename it to a PascalCase component, or return values instead of elements.

## What it flags

A function whose declared name matches the hook pattern (`useX`) whose **own** body returns JSX —
directly, or through a ternary / `&&`:

```tsx
// ✗ a "hook" that returns markup
function useUserBadge(user) {
  return <span>{user.name}</span>;
}

// ✓ a hook returns data
function useUserBadge(user) {
  return { label: user.name };
}

// ✓ this is a component — name it like one
function UserBadge({ user }) {
  return <span>{user.name}</span>;
}
```

Returns inside **nested** functions (render callbacks, `.map` bodies) belong to those functions, not
the hook, and are not attributed to it.

## Options

This rule has no options.

## When not to use it

If you intentionally build element-returning helpers under a `use*` name, this rule will fight you —
but the more idiomatic fix is to rename them to PascalCase components.
