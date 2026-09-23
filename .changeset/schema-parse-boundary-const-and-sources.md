---
'@noctcore/eslint-plugin-contracts': minor
---

`require-schema-parse-at-boundary` now follows same-function `const` bindings and knows more
boundary reads. `const raw = await res.json(); return raw as User;` is reported, unless the binding
is read before the cast by anything other than another cast (a guard, a validator call, an `in`
check) or from a nested function; `let`, destructuring and parameters are not followed. New
built-in sources: `localStorage.getItem` / `sessionStorage.getItem`, `URLSearchParams` `.get` /
`.getAll` (including `<x>.searchParams` and a `searchParams` binding), `event.data` in a `message`
listener, and an Anthropic `tool_use` block's `.input` when a `block.type === 'tool_use'` guard,
`case`, `.find` or `.filter` proves the block type. OpenAI `JSON.parse(call.function.arguments)` was
already covered by `JSON.parse`. A union cast target containing a shape claim (`as User | null`) now
counts as a shape claim. The new `boundaries` option adds your own callees (`readBody`,
`ipcRenderer.invoke`); it defaults to `[]`.

The rule stays `off` in `recommended`, so a project that spreads `recommended` as-is sees no new
errors. A project that has enabled the rule can see new errors from the binding-following, the new
sources and the union targets.
