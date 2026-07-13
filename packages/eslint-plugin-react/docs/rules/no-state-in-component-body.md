# `noctcore-react/no-state-in-component-body`

> State, effect, and query hooks belong in the colocated hook file, not the component body.

## Why

A component file (`<Name>.tsx`) should read like a thin presentation shell: props in, JSX out. When
`useState`, `useEffect`, `useQuery`, or a store hook lives directly in the render body, the component
owns behavior it should merely consume. Moving that logic into the colocated hook file
(`<Name>.hooks.ts` by convention) keeps the shell declarative, makes the behavior independently
testable, and keeps re-render surfaces small.

## What it flags

Inside a component file (`.tsx` that is **not** a hook file), a call to any of:

- React stateful hooks — `useState`, `useReducer`, `useEffect`, `useLayoutEffect`,
  `useInsertionEffect`, `useMemo`, `useCallback`, `useRef`, `useImperativeHandle`;
- react-query data hooks — `useQuery`, `useMutation`, `useInfiniteQuery`, `useSuspenseQuery`,
  `useQueries`;
- store hooks matching `storeHookPattern` (default `use*Store`);
- anything in `additionalHooks`.

`useId`, `useTransition`, and `useDeferredValue` are render-safe and allowlisted. Files whose basename
ends with a `hookFileSuffixes` entry (default `.hooks.ts`) are skipped — that is where the hooks
belong.

```tsx
// ✗ state in the component body (Widget.tsx)
export default function Widget() {
  const [open, setOpen] = useState(false);
  return <div />;
}

// ✓ the same state, colocated in Widget.hooks.ts
export function useWidget() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowedHooks` | `string[]` | `['useId', 'useTransition', 'useDeferredValue']` | Hook names that are always render-safe. |
| `additionalHooks` | `string[]` | `[]` | Extra hook names to flag. |
| `storeHookPattern` | `string` | `^use[A-Z][A-Za-z0-9]*Store$` | Regex marking store hooks as stateful. |
| `hookFileSuffixes` | `string[]` | `['.hooks.ts']` | Basename suffixes identifying the colocated hook file (skipped). |

```js
'noctcore-react/no-state-in-component-body': ['error', { additionalHooks: ['useBridge'] }]
```

## When not to use it

If you do not separate component shells from colocated hook files, this rule will fight your layout.
It assumes state lives in a sibling hook file rather than the `.tsx`.
