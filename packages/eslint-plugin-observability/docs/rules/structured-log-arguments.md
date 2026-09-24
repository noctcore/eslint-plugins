# `noctcore-observability/structured-log-arguments`

> Pass dynamic values in a structured context object, not interpolated into the log message string.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Dynamic values baked into a log **message** string are unqueryable. When you write

```ts bad
logger.info(`processing task ${taskId} for ${userId}`);
```

a log aggregator stores one opaque line of free text — it cannot index, filter, group, or alert on
`taskId` or `userId`, because they are fused into the message. The value belongs in a structured
context object, where each field stays a first-class, queryable attribute:

```ts good
logger.info('processing task', { taskId, userId });
```

## What it flags

A logger call — `<logger>.<method>(...)` where `<method>` is `info` / `warn` / `error` / `debug` and
`<logger>` is a configured logger name — that receives a **template literal with expressions** as a
**direct** positional argument.

```ts bad
// dynamic values interpolated into the message
logger.error(`failed: ${err.code}`);
```

```ts good
// static message + structured context
logger.error('request failed', { code: err.code });
```

Matched purely structurally (no type information). Both `logger.info(...)` and a logger held on a
namespace or `this` (`this.logger.info(...)`, `app.log.warn(...)`) are recognised.

## What it does not flag

Only **direct** arguments are inspected. A template literal nested inside a context object is building
a value, not the message, and is never flagged:

```ts good
// the template builds a URL field, not the message
logger.info('fetching', { url: `${base}/tasks` });
```

A template with **no** expressions carries no dynamic value and is ignored
(`logger.info(\`ready\`)`).

> Note: `console.log(...)` uses the `log` method, which is not one of the tracked log levels
> (`info` / `warn` / `error` / `debug`), so it is out of scope by design.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `loggers` | `string[]` | `['console', 'logger', 'log']` | Logger object names to scan. |

```js
'noctcore-observability/structured-log-arguments': ['error', { loggers: ['logger', 'log', 'pino'] }]
```

## When not to use it

If your logging layer only accepts a single formatted string (no structured-context argument), this
rule cannot be satisfied — turn it off for that codebase.
