# `noctcore-observability/no-sensitive-fields-in-logs`

> A name-heuristic guard against writing credentials and secrets into log sinks. Ships at `error`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Logs are long-lived, widely readable, and shipped to third-party aggregators. A `password`, `token`,
`secret`, or `authorization` header written into a log line is a credential leak that outlives the
request by months. This rule catches the most common shape — a variable, property, or object key
whose **name** matches a sensitive-field denylist appearing inside a logger call.

It reads **names, never values**, so it is a heuristic. It still ships at `error`: a miss puts a
credential in a long-lived log sink, while a false positive costs a rename or a `redact()` call.
Tests that log a secret on purpose (to prove a redaction boundary works) should turn the rule off for
those files in config.

## What it flags

Inside a logger call (`<logger>.<method>(...)`), any identifier, member-access property, or object key
whose name matches the denylist:

```ts bad reports=3
// all three flag
logger.info('login', { password });
logger.error('auth failed', { userPassword: pw });
logger.info('session', user.token);
```

```ts good
// log who, not the credential
logger.info('login', { userId });
logger.error('auth failed', { userId, reason: 'bad-credentials' });
logger.info('session', { sessionId: user.sessionId });
```

A call to a redactor is a boundary. The rule does not look inside `redact(...)` or `mask(...)` (set
the list with `redactors`), and an object key whose value is a redactor call is not reported:

```ts good
// the value is redacted, so neither the key nor the argument is reported
logger.info('login', { token: redact(token) });
logger.info('login', { password: mask(user.password) });
```

Matching is **name-segment aware**. A single-word denyName (`token`) matches a camelCase or
snake_case segment (`accessToken`, `access_token`) but **not** a longer word that merely contains it
(`tokenize`, `tokenizer`). A multi-word denyName (`apiKey`) matches the compacted name
(`myApiKey` → contains `apikey`).

## What it does not flag

String **literals** are never inspected — only names — so a message that mentions a sensitive word is
fine:

```ts good
// a literal, not a value
logger.info('password reset email sent');
```

- A longer word that merely contains a denyName (`tokenizer`, `tokenize`): matching is by name
  segment, as described above.
- Names that read as a flag, a count or a timestamp about the field rather than the field itself:
  a leading `is`, `has`, `should`, `can`, `did`, `was`, `needs` or `show` segment, or a trailing
  `count`, `length`, `size`, `ttl`, `at`, `in`, `expires`, `expiry`, `consent`, `enabled` or
  `required` segment (`hasPassword`, `tokenCount`, `passwordLength`, `tokenExpiresAt`,
  `cookieConsent`).
- Names listed in `allowNames`.
- Sensitive names outside a logger call (`save({ password })`). A logger call is a name from
  `loggers` with a method from `methods`; the defaults cover `console.log`, Nest's
  `this.logger.log` / `verbose` / `fatal` and pino's `trace` / `fatal`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `denyNames` | `string[]` | `['password', 'token', 'secret', 'authorization', 'cookie', 'apiKey', 'ssn']` | Field names to treat as sensitive (case-insensitive, segment-aware). |
| `redactors` | `string[]` | `['redact', 'mask']` | Called names (`redact(x)`, `utils.redact(x)`) whose arguments are not inspected. |
| `allowNames` | `string[]` | `[]` | Exact names never reported (`csrfToken`). |
| `loggers` | `string[]` | `['console', 'logger', 'log']` | Logger object names to scan. |
| `methods` | `string[]` | `['info', 'warn', 'error', 'debug', 'log', 'trace', 'fatal', 'verbose']` | Method names that make a call on a logger a log call. |

```js
'noctcore-observability/no-sensitive-fields-in-logs': ['error', {
  denyNames: ['password', 'token', 'secret', 'authorization', 'cookie', 'apiKey', 'ssn', 'iban'],
  redactors: ['redact', 'mask', 'scrub'],
}]
```

## When not to use it

If your logging pipeline already redacts sensitive fields centrally (a serializer denylist), this
rule is redundant. Otherwise keep it on at `error` as a second line of defence.
