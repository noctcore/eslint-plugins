---
'@noctcore/eslint-plugin-observability': minor
---

Add two opt-in rules for stable event identifiers in logs.

`require-event-field` reports a logger call whose object-literal payload has no event field (option `eventField`, default `event`), or that has no payload at all. The payload may come first (pino) or later. A string-literal key and shorthand count. A payload with a spread or a computed key, and an argument the rule cannot inspect (an identifier, a call, a member access), are accepted, because they may supply the field.

`typed-event-names` checks the event field against the names a project declares in one module: an exported `const` tuple of strings, or an object whose string values are the names (nested objects included; `as const`, `satisfies` and `Object.freeze` are fine). Options `eventNamesModule` (resolved against the working directory, then against the linted file; the extension may be left off) and `eventNamesExport` (default `LOG_EVENTS`). It reports an unknown string literal (with a "did you mean" hint), a missing `LOG_EVENTS.x` entry, and a value it cannot check (a variable, a call, an interpolated template). The module is parsed with the TypeScript parser and re-read when its modification time moves. When the module is unset, missing, or does not export a readable list, the rule reports a configuration error once per linted file instead of going quiet.

Both rules take the shared `loggers` and `methods` options. Neither is in `recommended`, so a project spreading `recommended` sees no new errors. Enable them with `'noctcore-observability/require-event-field': 'error'` and `'noctcore-observability/typed-event-names': ['error', { eventNamesModule: 'src/log-events.ts' }]`.
