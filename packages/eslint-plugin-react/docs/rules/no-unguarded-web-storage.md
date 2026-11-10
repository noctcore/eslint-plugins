# `noctcore-react/no-unguarded-web-storage`

> A `localStorage` / `sessionStorage` access must sit inside a `try` with a `catch`, because the access itself can throw. 💡

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

### Severity

Ships as `error` in the `recommended` preset. Every report is a call that throws for a real class of
users, and the guard that silences it is the fix, not a workaround.

## What it flags

A member read of `localStorage` or `sessionStorage` (a method call such as `getItem(...)`, or a
plain read such as `length` or `['key']`), written bare, through `window.`, `globalThis.` or `self.`,
or through a `const` alias of either, when **no `try` with a `catch` is on the stack when it runs**.
Every member counts (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), because the
failing step can be the property access itself, before any method runs.

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

### A `try` around a callback does not guard the callback

A `try` only catches what throws while it is on the stack. A listener, a timer or a `.then`
callback defined inside a `try` runs after the `try` has finished, so the rule checks it on its own.
A callback that runs on the spot, such as an IIFE or the callback of `forEach`, `map` or
`Array.from`, stays covered. A `try` with only a `finally` catches nothing.

```tsx bad reports=2
// the try has ended by the time either callback runs
function subscribe(): void {
  try {
    window.addEventListener('storage', () => {
      sessionStorage.removeItem('draft');
    });
    setTimeout(() => localStorage.setItem('seen', '1'), 1000);
  } catch {
    // never reached by the callbacks
  }
}
```

```tsx good
// each callback guards its own access
function subscribe(): void {
  window.addEventListener('storage', () => {
    try {
      sessionStorage.removeItem('draft');
    } catch {
      // Storage is unavailable. Nothing to clear.
    }
  });
  setTimeout(() => {
    try {
      localStorage.setItem('seen', '1');
    } catch {
      // Storage is unavailable or full. The banner may show again.
    }
  }, 1000);
}
```

### An alias is the same object

`const store = window.localStorage` gives the object another name; reading through it throws the
same way. The rule follows a `const` binding of the storage object, with or without a type cast.

```tsx bad
// the alias reads the same storage object
const store = window.localStorage;
export function visits(): number {
  return Number(store.getItem('visits') ?? 0);
}
```

```tsx good
// guarded where the alias is read
const store = window.localStorage;
export function visits(): number {
  try {
    return Number(store.getItem('visits') ?? 0);
  } catch {
    return 0;
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

### Suggestion

There is no autofix, because wrapping a call changes control flow: what the code does when storage
fails is a decision, not a mechanical edit. The rule offers a suggestion that wraps the reported
statement in `try { ... } catch { ... }` when the statement is a plain expression or a `return`
sitting directly in a block. A `const x = localStorage.getItem(...)` gets no suggestion, since a `try`
around the declaration would scope `x` to it.

## What it does not flag

- An access inside a `try` with a `catch` at any nesting depth, including inside a callback that
  runs before the `try` ends (an IIFE, `forEach`, `map`, `Array.from`).
- A wrapper or helper (`safeStorage.get(...)`, `storage.getItem(...)`): the object is not the
  global. Put the `try` inside the helper and the rule checks it there.
- A bare reference to the object that reads no member, such as
  `createJSONStorage(() => localStorage)` or `const store = window.sessionStorage`. Reading
  `window.sessionStorage` can throw too, but the line that defines an alias is not reported; the
  reads through the alias are.
- A `let` alias, which can be reassigned to a shim later, and an alias passed through a function
  parameter.
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

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**", "**/e2e/**"]` | File-path globs where a bare storage access is allowed. Replaces the default list. |

The default exempts tests, where storage runs under jsdom and cannot throw. Setting the option
replaces the list, so include the test globs again if you add to it.

```js
'noctcore-react/no-unguarded-web-storage': ['error', {
  allowIn: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/electron/**'],
}]
```

## When not to use it

In a runtime where storage cannot be disabled, such as an Electron renderer, a Capacitor shell or a
browser extension page, `getItem` will not throw. `setItem` still throws on quota, so the rule is
still worth running, but if that risk is accepted, exempt those paths with `allowIn` rather than
turning the rule off for the whole project.
