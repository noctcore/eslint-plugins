---
'@noctcore/eslint-plugin-rsc': minor
---

New package: React Server Components and App Router correctness rules, framework-neutral where the RSC model allows. One rule, in `recommended` at `error`: `no-navigation-throw-in-try`.

`no-navigation-throw-in-try` reports a call to `redirect`, `permanentRedirect`, `notFound`, `forbidden` or `unauthorized` imported from `next/navigation` (aliases and `import * as nav` included) inside a `try` whose `catch` swallows the error those functions throw, so the navigation never happens. A `catch` that calls `unstable_rethrow(error)` from `next/navigation` or rethrows the caught error (`throw error`, also behind a guard such as `if (isRedirectError(error))`) is accepted. Calls outside a `try`, in a `try`/`finally` with no `catch`, in the `catch` or `finally` itself, inside a function merely defined in the `try`, and same-named functions not imported from `next/navigation` are left alone. A project that spreads `recommended` can see new errors, each one a navigation that is currently being swallowed.
