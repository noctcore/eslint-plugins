# `noctcore-observability/no-sensitive-fields-in-logs`

> A name-heuristic guard against writing credentials and secrets into log sinks. Ships at `warn`.

## Why

Logs are long-lived, widely readable, and shipped to third-party aggregators. A `password`, `token`,
`secret`, or `authorization` header written into a log line is a credential leak that outlives the
request by months. This rule catches the most common shape — a variable, property, or object key
whose **name** matches a sensitive-field denylist appearing inside a logger call.

It reads **names, never values**, so it is a heuristic and ships at `warn`, not `error` — treat a hit
as "look here", not "definitely a bug".

## What it flags

Inside a logger call (`<logger>.<method>(...)`), any identifier, member-access property, or object key
whose name matches the denylist:

```ts
// ✗ all three flag
logger.info('login', { password });
logger.error('auth failed', { userPassword: pw });
logger.info('session', user.token);

// ✓ redact first
logger.info('login', { password: redact(password) });
```

Matching is **name-segment aware**. A single-word denyName (`token`) matches a camelCase or
snake_case segment (`accessToken`, `access_token`) but **not** a longer word that merely contains it
(`tokenize`, `tokenizer`). A multi-word denyName (`apiKey`) matches the compacted name
(`myApiKey` → contains `apikey`).

String **literals** are never inspected — only names — so a message that mentions a sensitive word is
fine:

```ts
// ✓ a literal, not a value
logger.info('password reset email sent');
```

## Options

```ts
type Options = {
  /**
   * Field names to treat as sensitive (case-insensitive, segment-aware).
   * Default: ['password', 'token', 'secret', 'authorization', 'cookie', 'apiKey', 'ssn'].
   */
  denyNames?: string[];
};
```

## When not to use it

If your logging pipeline already redacts sensitive fields centrally (a serializer denylist), this
rule is redundant. Otherwise keep it on at `warn` as a second line of defence.
