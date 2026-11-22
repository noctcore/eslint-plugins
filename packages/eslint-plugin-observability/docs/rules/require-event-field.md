# `noctcore-observability/require-event-field`

> A logger call must carry a stable event identifier in its structured payload, so searches and alerts do not match on message text.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A log line that is found by its message text breaks the day someone rewords the message. The
dashboard, the alert and the saved search all match on a substring that no longer exists, and
nothing fails: the panel just goes quiet.

```ts bad
log.info({ invoiceId }, 'invoice paid');
```

A stable identifier in the structured payload is what those queries should key on. The message can
then change freely.

```ts good
log.info({ event: 'invoice.paid', invoiceId }, 'invoice paid');
```

## What it flags

A logger call (`<logger>.<method>(...)`, with the same `loggers` and `methods` matching as the other
observability rules) when

- it has an object-literal argument, and no object-literal argument has the event field. The
  payload may come first (pino) or later (most other loggers);
- it has no payload at all: every argument is a string, number or template literal, or there are
  no arguments.

```ts bad reports=2
this.logger.error('charge failed', { invoiceId, code });
log.warn('retrying');
```

```ts good
this.logger.error('charge failed', { event: 'invoice.charge-failed', invoiceId, code });
log.warn({ event: 'invoice.charge-retried' }, 'retrying');
```

A string-literal key (`{ 'event': 'invoice.paid' }`) and shorthand (`{ event }`) both count. The
field must be on the payload object itself: `{ meta: { event: 'invoice.paid' } }` is reported.

## What it does not flag

What the rule cannot see, it accepts, because guessing would report correct code:

- An object with a spread (`{ ...ctx, invoiceId }`) or a computed key (`{ [EVENT_KEY]: 'x' }`): the
  spread or the key may supply the field.
- An argument that is an identifier, a call or a member access (`log.info('paid', ctx)`,
  `log.info(buildPayload(invoice))`): it may be a payload built elsewhere. The same goes for a call
  that spreads its arguments (`log.info(...args)`). This is also the rule's main blind spot: a
  `log.error('failed', err)` passes, because `err` cannot be told from a context object without
  types.
- Calls on names outside `loggers`, or methods outside `methods`, such as `log.child({ ... })`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `eventField` | `string` | `'event'` | The payload key that holds the event identifier. |
| `loggers` | `string[]` | `['console', 'logger', 'log']` | Logger object names to scan. |
| `methods` | `string[]` | `['info', 'warn', 'error', 'debug', 'log', 'trace', 'fatal', 'verbose']` | Method names that make a call on a logger a log call. |

```js
'noctcore-observability/require-event-field': ['error', {
  eventField: 'event',
  loggers: ['logger', 'log'],
  methods: ['info', 'warn', 'error', 'fatal'],
}]
```

Scripts and tests rarely need event identifiers; turn the rule off for them in a later config block.

## When not to use it

If your logs are read by people rather than queried, or your logging layer cannot take a structured
payload, an event field buys nothing. Leave the rule off.

## Related

- [`typed-event-names`](/eslint-plugins/rules/observability/typed-event-names/) checks that the
  event field holds a name the project declared.
- [`structured-log-arguments`](/eslint-plugins/rules/observability/structured-log-arguments/) keeps
  dynamic values out of the message string.
