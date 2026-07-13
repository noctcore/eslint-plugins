# `noctcore-observability/structured-log-arguments`

> Pass dynamic values in a structured context object, not interpolated into the log message string.

## Why

Dynamic values baked into a log **message** string are unqueryable. When you write

```ts
logger.info(`processing task ${taskId} for ${userId}`);
```

a log aggregator stores one opaque line of free text — it cannot index, filter, group, or alert on
`taskId` or `userId`, because they are fused into the message. The value belongs in a structured
context object, where each field stays a first-class, queryable attribute:

```ts
logger.info('processing task', { taskId, userId });
```

## What it flags

A logger call — `<logger>.<method>(...)` where `<method>` is `info` / `warn` / `error` / `debug` and
`<logger>` is a configured logger name — that receives a **template literal with expressions** as a
**direct** positional argument.

```ts
// ✗ dynamic values interpolated into the message
logger.error(`failed: ${err.code}`);

// ✓ static message + structured context
logger.error('request failed', { code: err.code });
```

Matched purely structurally (no type information). Both `logger.info(...)` and a logger held on a
namespace or `this` (`this.logger.info(...)`, `app.log.warn(...)`) are recognised.

Only **direct** arguments are inspected. A template literal nested inside a context object is building
a value, not the message, and is never flagged:

```ts
// ✓ the template builds a URL field, not the message
logger.info('fetching', { url: `${base}/tasks` });
```

A template with **no** expressions carries no dynamic value and is ignored
(`logger.info(\`ready\`)`).

> Note: `console.log(...)` uses the `log` method, which is not one of the tracked log levels
> (`info` / `warn` / `error` / `debug`), so it is out of scope by design.

## Options

```ts
type Options = {
  /** Logger object names to scan. Default: ['console', 'logger', 'log']. */
  loggers?: string[];
};
```

## When not to use it

If your logging layer only accepts a single formatted string (no structured-context argument), this
rule cannot be satisfied — turn it off for that codebase.
