---
"@noctcore/eslint-plugin-react": minor
"@noctcore/eslint-plugin-contracts": minor
"@noctcore/eslint-plugin-architecture": minor
---

`@noctcore/eslint-plugin-react`: **behaviour change for consumers.** The `recommended` preset no
longer ships any rule at `warn`. House policy is `error` or `off`: a warning is a rule nobody obeys,
and a project that refuses `warn` in its resolved config could not use the preset at all.

- `no-effect-derived-state`: `warn` to `error`. It fires only on an effect whose whole body is
  `setX(...)` of values read from its own deps; any branch, call, await or cleanup bails out.
- `require-effect-cancellation`: `warn` to `error`. A state update after an await with nothing to
  cancel it is a real bug, and any recognisable guard (an `AbortController`, a `cancelled` flag, a
  cleanup `return`) silences it.

Projects that spread `react.configs.recommended` as-is will now fail lint on findings that used to
print as warnings. To keep the old behaviour, set either rule back yourself after the preset. A test
in every plugin now fails if any preset emits `warn`.

`@noctcore/eslint-plugin-contracts`: `money-must-be-decimal` gains a `minorUnitPatterns` option.
Payment APIs such as Stripe carry money as an integer count of minor units (`amount: 1999` is
19.99), which is exact in a `number`. List the regex fragments (case-insensitive, unanchored, so
anchor them: `['^amount$', 'Cents$']`) that name such fields and the rule skips them. The default is
empty, so nothing changes until you opt in.

`@noctcore/eslint-plugin-architecture`: `component-folder-structure` no longer requires a
`<Name>.hooks.ts` sibling by default. A presentational component has no logic to extract, and
requiring the file produced empty `export {}` modules that exist only to satisfy the linter. The
default set is now `.types.ts`, `.stories.tsx`, `.test.tsx` and `index.ts`. To keep the old
behaviour, pass `requiredSiblings: ['.hooks.ts', '.types.ts', '.stories.tsx', '.test.tsx',
'index.ts']`. This only removes findings; it cannot surface new ones.
