# `noctcore-react/no-unguarded-web-storage`

> A `localStorage` / `sessionStorage` call must sit inside a `try` block, because the access itself can throw. 💡

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💡 Offers editor suggestions · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`localStorage` and `sessionStorage` are not plain objects. Reading the property throws a
`SecurityError` when storage is disabled: Firefox with cookies blocked, a sandboxed iframe without
`allow-same-origin`, or a third-party context under storage partitioning. `setItem` throws a
`QuotaExceededError` when the quota is exhausted, and some private modes set that quota to zero.

The code compiles, the tests pass under jsdom, and the exception lands in a render or an event
handler for a slice of real users. Wrapped in `try`, a storage failure degrades to a default. Bare,
it is a blank screen.

## What it flags

A call whose callee is a method of `localStorage` or `sessionStorage`, written bare or through
`window.`, `globalThis.` or `self.`, when **no enclosing `try` block covers it at any depth**. Every
method counts (`getItem`, `setItem`, `removeItem`, `clear`, `key`), because the failing step can be
the property access itself, before any method runs.

```tsx bad
// throws in private browsing or when storage is disabled
function readTheme(): string {
  return localStorage.getItem('theme') ?? 'light';
}
```

```tsx good
// guarded; a storage failure degrades to the default
function readTheme(): string {
  try {
    return localStorage.getItem('theme') ?? 'light';
  } catch {
    return 'light';
  }
}
```

### A `typeof window` check is not a guard

This is the case the rule exists for. The author guarded the server render and believed that was
enough. It is not: `typeof window === 'undefined'` fences off SSR, and the throw happens in the
browser, where `window` is defined. Both calls below are reported.

```tsx bad reports=2
// guards SSR, not the browser-side throw
export function Boot() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const alreadyBooted = window.sessionStorage.getItem(BOOT_STORAGE_KEY);
    if (alreadyBooted) {
      setGone(true);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (ready || gone) {
      window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1');
    }
  }, [ready, gone]);

  return null;
}
```

```tsx good
// the read and the write each fall back when storage is unavailable
export function Boot() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alreadyBooted: string | null = null;
    try {
      alreadyBooted = window.sessionStorage.getItem(BOOT_STORAGE_KEY);
    } catch {
      // Storage is unavailable. Treat the visit as a first boot.
    }
    if (alreadyBooted) {
      setGone(true);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready && !gone) return;
    try {
      window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1');
    } catch {
      // Storage is unavailable or full. The splash may replay; that is fine.
    }
  }, [ready, gone]);

  return null;
}
```

### What it does not flag

- A call inside a `try` block at any nesting depth, including a `try` in an outer function around
  an inline callback. That outer `try` does not run when the callback fires later, but the rule errs
  toward silence.
- A wrapper or helper (`safeStorage.get(...)`, `storage.getItem(...)`): the callee is not the
  global. Put the `try` inside the helper and the rule checks it there.
- A non-call reference to the object, such as `createJSONStorage(() => localStorage)` or
  `const store = window.sessionStorage`.
- A `localStorage` declared in the file (a memory shim, a parameter).
- Storage code written as **text**, such as an inline boot script built from strings. It is a string
  literal, not a call expression, so an AST rule sees nothing, and that is correct: the script guards
  itself.

```tsx good
// a string, not a call: the inline script carries its own try/catch
export const APPEARANCE_BOOT_SCRIPT = [
  '(function(){var r=document.documentElement;',
  'try{',
  `var m=localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)});`,
  "if(m==='dark')r.classList.add('dark');",
  '}catch(e){}})()',
].join('');
```

A `catch` or `finally` body is not covered by its own `try`, and a sibling `try` does not enclose
the statement after it.

## Suggestion

There is no autofix, because wrapping a call changes control flow: what the code does when storage
fails is a decision, not a mechanical edit. The rule offers a suggestion that wraps the reported
statement in `try { ... } catch { ... }` when the statement is a plain expression or a `return`
sitting directly in a block. A `const x = localStorage.getItem(...)` gets no suggestion, since a `try`
around the declaration would scope `x` to it.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**", "**/e2e/**"]` | File-path globs where a bare storage call is allowed. Replaces the default list. |

The default exempts tests, where storage runs under jsdom and cannot throw. Setting the option
replaces the list, so include the test globs again if you add to it.

```js
'noctcore-react/no-unguarded-web-storage': ['error', {
  allowIn: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/electron/**'],
}]
```

## Severity

Ships as `error` in the `recommended` preset. Every report is a call that throws for a real class of
users, and the guard that silences it is the fix, not a workaround.

## When not to use it

In a runtime where storage cannot be disabled, such as an Electron renderer, a Capacitor shell or a
browser extension page, `getItem` will not throw. `setItem` still throws on quota, so the rule is
still worth running, but if that risk is accepted, exempt those paths with `allowIn` rather than
turning the rule off for the whole project.
