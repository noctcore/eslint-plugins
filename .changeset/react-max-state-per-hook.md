---
'@noctcore/eslint-plugin-react': minor
---

New rule `max-state-per-hook`, on in `strict` at `error` and left out of `recommended`.

In hook files (`*.hooks.ts` and `*.hooks.tsx` by default), it caps the `useState` / `useReducer`
slots one `use*` hook keeps (`max`, default 4; a private sub-hook has its own budget, and a frozen
`const [x] = useState(init)` is skipped unless `countFrozen` is set), and the distinct `useState`
setters one function nested in a hook calls (`maxSettersPerFunction`, default 3, `0` turns it off).
`useRef`, query and mutation hooks, `dispatch`, and setters from props or context are not counted.
The file gate is `hookFileSuffixes`, also accepted as `fileSuffixes` (the name `max-hooks-per-file`
uses); when both are set they are combined.

A project that spreads `recommended` sees no change. A project that spreads `strict` can see new
errors on hooks that keep more than four pieces of state or set more than three of them in one
handler; raise the options or turn the rule off to keep the previous behaviour.
