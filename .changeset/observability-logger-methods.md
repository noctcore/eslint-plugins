---
'@noctcore/eslint-plugin-observability': minor
---

Check the logger methods consumers actually call, and stop `no-sensitive-fields-in-logs` reporting its own advised `redact()` fix.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- `structured-log-arguments`, `no-sensitive-fields-in-logs` and `no-error-detail-loss` take a new `methods` option. The default adds `log`, `trace`, `fatal` and `verbose` to `info`, `warn`, `error` and `debug`, so `console.log(...)`, Nest's `this.logger.log(...)` / `verbose(...)` / `fatal(...)` and pino's `trace(...)` / `fatal(...)` are now checked. Set `methods: ['info', 'warn', 'error', 'debug']` to keep the old scope.
- `no-sensitive-fields-in-logs` and `no-error-detail-loss` now read the `loggers` option (`structured-log-arguments` already did). Before, both used the default `console`, `logger`, `log` whatever you configured.

**Reports less:**

- `no-sensitive-fields-in-logs` treats a redactor call as a boundary: it does not look inside `redact(...)` or `mask(...)` (set the list with the new `redactors` option), and an object key whose value is a redactor call is not reported. `logger.info('login', { token: redact(token) })` is clean; before, it gave two errors.
- `no-sensitive-fields-in-logs` skips names that read as a flag, a count or a timestamp about the field (`hasPassword`, `isTokenValid`, `tokenCount`, `passwordLength`, `tokenExpiresAt`, `cookieConsent`). A new `allowNames` option lists exact names never reported.
