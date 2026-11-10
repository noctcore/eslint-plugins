---
'@noctcore/eslint-plugin-react': minor
---

Close gaps in three `recommended` rules and move the `max-hooks-per-file` report off the whole file.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- `no-unguarded-web-storage` now requires a `try` with a `catch`: a `try` with only a `finally` no longer counts as a guard. A callback defined inside a `try` but run later (a listener, a timer, a `.then` callback, an async IIFE) is no longer treated as guarded; an IIFE and the callback of a synchronous array method (`forEach`, `map`, `Array.from`, ...) still are. The rule also reports plain member reads (`localStorage.length`, `sessionStorage['key']`) and reads through a `const` alias (`const store = window.localStorage; store.getItem(...)`). A bare reference such as `createJSONStorage(() => localStorage)` is still left alone.
- `require-effect-cancellation` no longer takes every top-level `return` for a cancellation guard. A returned cleanup counts when it sets something (`cancelled = true`, `live.current = false`), calls an abort or cancel method, or cannot be seen into (`return unsubscribe`). A cleanup that only clears a timer or removes a listener no longer silences the rule.

**Report placement:** `max-hooks-per-file` reports on the first exported hook past the limit instead of on the whole file, so an editor underlines the export to move. The count and the message are unchanged.

`component-props-naming`, `no-effect-derived-state` and `require-effect-cancellation` walk the tree over the parser's visitor keys (shared helpers from `@noctcore/eslint-utils`) instead of every object key. No report changes from that.

`no-state-in-component-body` gains no `includeNestedComponents` option: it already checks every `.tsx`, nested sub-components included, and its doc now says so and shows how to skip stories and component tests with `hookFileSuffixes`.
