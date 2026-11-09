---
'@noctcore/eslint-plugin-react': minor
---

Fix false positives and false negatives in seven `recommended` rules, and stop the `component-props-naming` autofix writing code that does not compile.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- `prefer-lazy-state-init` now sees the call under a TypeScript wrapper or a fallback: `useState(JSON.parse(raw) as Foo)`, `useState(JSON.parse(raw) ?? {})`, `useState(localStorage.getItem('k')!)`. The fix wraps the whole argument.
- `context-value-must-be-memoized` now reports an inline array (`value={[a, b]}`) and an inline arrow or function, and scans every file with JSX instead of `.tsx` only. A call (`value={store.snapshot()}`) is still left alone.
- `no-state-in-component-body` now reports hooks called through a namespace (`React.useState(0)`).

**Reports less:**

- `no-effect-derived-state` and `require-effect-cancellation` no longer take every `setX(...)` call for a state setter. The callee must resolve, through scope analysis, to a setter destructured from `useState` / `useReducer` (or the `dispatch` of `useReducer`). `setTimeout`, `setInterval`, and a setter from a context hook or a prop are no longer reported. `no-effect-derived-state` also skips prop-to-state with local edits (`const [draft, setDraft] = useState(value)` re-synced from `value`).
- `component-props-naming` no longer reports a props type that is not declared in the file (`import type { IconProps } from './types'`): a shared or library props type is correct as written. A new `pattern` option (default `{Component}Props`) expresses `I{Component}Props` for codebases with an interface-prefix rule.
- `props-must-be-visual` anchors the `token` and `secret` defaults at the end of the name (`token$`, `secret$`), so a design `tokens` list, a `tokenCount` and a `showSecretField` flag are no longer reported. `resetToken` and `clientSecret` still are. A project that set `denyPropNames` keeps its list.

**Autofix change:** `component-props-naming` refuses the rename when the type is exported through a later `export { Props }` / `export type { Props }`, when any mention of the name is not a plain type reference (`interface Wide extends Props`, `implements Props`), or when the type is declared more than once. Before, the fix renamed the declaration and the parameter and left `extends Props` and the re-export pointing at nothing.
