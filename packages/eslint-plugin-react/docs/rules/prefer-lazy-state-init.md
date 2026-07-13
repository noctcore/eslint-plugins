# `noctcore-react/prefer-lazy-state-init`

> Wrap an expensive `useState` initializer call in a lazy function so it runs once, not every render.

🔧 This rule is automatically fixable.

## Why

`useState(expensiveCall())` evaluates its initializer on **every** render. React only keeps the
first result, so every render after the first pays the cost for nothing. Wrapping the initializer in
a function — `useState(() => expensiveCall())` — makes React call it once, lazily, on mount.

## What it flags

A `useState` call (or `React.useState`) whose first argument is a **call expression** whose callee
path is listed in `initializers`. By default that is `JSON.parse`, `localStorage.getItem`, and
`sessionStorage.getItem`. A callee is matched by its dotted path (`localStorage.getItem`) or bare
name (`buildInitialState`). Anything already wrapped in a function is left alone.

```tsx
// ✗ runs JSON.parse on every render
const [state, setState] = useState(JSON.parse(raw));

// ✓ lazy — runs once on mount
const [state, setState] = useState(() => JSON.parse(raw));
```

The autofix wraps the argument in `() => ...`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `initializers` | `string[]` | `['JSON.parse', 'localStorage.getItem', 'sessionStorage.getItem']` | Callee paths whose call in a `useState` initializer must be made lazy. Add your own expensive builders. |

```js
'noctcore-react/prefer-lazy-state-init': ['error', {
  initializers: ['JSON.parse', 'crypto.randomUUID', 'buildInitialState'],
}]
```

## When not to use it

If your `initializers` list only contains cheap calls, lazy init adds noise for no benefit — narrow
the list or disable the rule.
