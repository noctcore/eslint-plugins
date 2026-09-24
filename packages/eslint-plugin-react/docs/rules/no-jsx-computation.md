# `noctcore-react/no-jsx-computation`

> Keep JSX declarative — lift computation to a const above the return or into the hook.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Computation wedged directly into JSX children (`{items.map(...)}`, `{total - used}`,
`{a && b && <X/>}`) makes the render tree hard to read and re-runs on every render. Lifting it to a
`const` above the `return` (or into the hook) keeps the JSX declarative and the work explicit.

## What it flags

Directly inside a JSX child expression container (`{ ... }` whose parent is a JSX element or
fragment):

- array methods — `.map`, `.filter`, `.reduce`, `.sort`, `.find`, `.flatMap`;
- arithmetic — `-`, `*`, `/`, `%`, `**`;
- **chained** logical expressions (`a && b && c`) — reported once on the outermost link.

A single `{cond && <X/>}` guard and ternaries stay allowed. Computation inside event handlers
(`onClick={() => items.map(...)}`) is not render-time work and is not flagged.

```tsx bad reports=2
// computation in JSX
function Usage(props: UsageProps) {
  return (
    <div>
      <ul>{props.items.map((i) => <li key={i} />)}</ul>
      <span>{props.total - props.used}</span>
    </div>
  );
}
```

```tsx good
// lifted to a const above the return
function Usage(props: UsageProps) {
  const rows = props.items.map((i) => <li key={i} />);
  const remaining = props.total - props.used;
  return (
    <div>
      <ul>{rows}</ul>
      <span>{remaining}</span>
    </div>
  );
}
```

## Options

This rule has no options.

## When not to use it

If you prefer inline JSX expressions and are not concerned about render-time work in the tree, this
rule will be noisy — disable it.
