---
'@noctcore/eslint-plugin-contracts': minor
---

`no-error-stringify` no longer reports inside a logger call's arguments (`logger.error(`failed: ${err}`)`). That line belongs to observability `no-error-detail-loss`, which asks for the error object itself; this rule's advice (`err instanceof Error ? err.message : String(err)`) produced exactly the message-only log the other rule forbids, so the two gave opposite advice on one line.

New options: `checkLoggerArguments` (default `false`; set `true` to report inside logger calls as before, for a project that does not run the observability plugin), and `loggers` / `methods`, which take the same values as in `no-error-detail-loss` (defaults `console`, `logger`, `log` and the usual log levels). Stringifying outside a logger call, including in a callback passed to one, is reported as before.

A project that spreads `recommended` sees fewer reports, never new ones.
