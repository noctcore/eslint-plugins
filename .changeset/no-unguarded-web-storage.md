---
'@noctcore/eslint-plugin-react': minor
---

New rule `no-unguarded-web-storage`, shipped as `error` in `recommended`.

A `localStorage` / `sessionStorage` call must sit inside a `try` block. The property access
itself throws when storage is disabled (private browsing, blocked cookies, a sandboxed iframe,
storage partitioning), and `setItem` throws on an exhausted quota. The code compiles and the
tests pass under jsdom, then the exception lands in a render for a slice of real users.

The rule flags any storage method call, written bare or through `window.`, `globalThis.` or
`self.`, with no enclosing `try` at any depth. A `typeof window === 'undefined'` check is not a
guard: it fences off the server, and the throw happens in the browser. It stays silent for a
wrapper object, a non-call reference, a locally declared `localStorage`, storage code written as
text inside a string, and files matched by `allowIn` (tests and specs by default). A suggestion
wraps a plain expression or return statement in `try { ... } catch { ... }`.

Projects that spread `react.configs.recommended` will now fail lint on an unguarded storage
call. Wrap it, move it into a guarded helper, or exempt the path with `allowIn`.
