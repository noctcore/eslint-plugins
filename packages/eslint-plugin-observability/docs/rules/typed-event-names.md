# `noctcore-observability/typed-event-names`

> The event field of a logger call must be a name declared in the project event names module, so a typo or a stale name fails at lint time.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

An event identifier is only as good as its spelling. `invoice.payed` in one call site and
`invoice.paid` everywhere else splits one event into two, and the alert keyed on the right name
never sees the misspelled ones. Renaming an event leaves stale names behind in the same way. Keeping
the names in one module and checking every call site against it catches both at lint time, without
the type checker.

```ts prose reason="the rule reads the event names module named in its options from disk"
// src/log-events.ts
export const LOG_EVENTS = ['invoice.paid', 'invoice.failed'] as const;

// ✗ a typo splits the event in two
log.info({ event: 'invoice.payed', invoiceId }, 'paid');

// ✓
log.info({ event: 'invoice.paid', invoiceId }, 'paid');
```

## What it flags

The event field of every object-literal argument of a logger call (with the same `loggers` and
`methods` matching as the other observability rules) when its value is

- a string literal, or a template literal without expressions, that is not a declared name. The
  message suggests the closest declared name when one is within two edits;
- a member path from the export's name that does not exist (`LOG_EVENTS.invoice.payed`, an index
  past the end of the tuple), or one that stops on a group of names rather than a name;
- anything that cannot be checked: a variable, a call, an interpolated template.

Each branch of a conditional (`ok ? 'invoice.paid' : 'invoice.failed'`) is checked on its own.

```ts prose reason="the rule reads the event names module named in its options from disk"
// src/log-events.ts
export const LOG_EVENTS = {
  invoice: { paid: 'invoice.paid', failed: 'invoice.failed' },
} as const;

// ✗
log.info({ event: 'invoice' });              // a key, not a name
log.info({ event: LOG_EVENTS.invoice.payed }); // no such entry
log.info({ event: `invoice.${status}` });    // cannot be checked

// ✓
log.info({ event: 'invoice.paid' });
log.info({ event: LOG_EVENTS.invoice.paid });
log.info({ event: ok ? LOG_EVENTS.invoice.paid : LOG_EVENTS.invoice.failed });
```

### The event names module

`eventNamesExport` (default `LOG_EVENTS`) names a top-level `const` in the module, exported
directly or through `export { local as LOG_EVENTS }`. Its value is a tuple of strings or an object
whose string values are the names, nested objects and arrays included. `as const`, `satisfies` and
`Object.freeze(...)` around the value are fine.

### Configuration errors

When `eventNamesModule` is unset, the module cannot be found or read, or the export is missing,
not a `const`, or not made only of string literals, arrays and objects (a spread, a call, a
computed value), the rule reports that once per linted file, on the first event field. A rule that
silently stopped checking would read as coverage the project does not have. Files without an event
field never see the error.

## What it does not flag

- A logger call without the event field, and a payload that only spreads one in. Requiring the
  field is [`require-event-field`](/eslint-plugins/rules/observability/require-event-field/)'s job.
- A member path is matched on the export's name (`LOG_EVENTS.x`), not on where the name was
  imported from. A local variable that happens to share the name is read as the export.
- Values passed through a variable or a helper (`const event = 'invoice.paid'; log.info({ event })`)
  are reported as unchecked, not followed. Write the literal or the entry at the call site.

### Edits to other files

This rule also reads the event names module, so its result can change when that file does. The
parsed module is re-read when its modification time moves, so a long-running editor server sees a
new name. `eslint --cache` does not notice and keeps the old result until the linted file itself
changes. See [Rules that read other files](https://noctcore.github.io/eslint-plugins/filesystem-rules/).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `eventNamesModule` | `string` | (none, required) | Path to the module that exports the names, resolved against the ESLint working directory and then against the linted file. The extension may be left off (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` are tried). |
| `eventNamesExport` | `string` | `'LOG_EVENTS'` | The exported constant that holds the names. |
| `eventField` | `string` | `'event'` | The payload key that holds the event identifier. |
| `loggers` | `string[]` | `['console', 'logger', 'log']` | Logger object names to scan. |
| `methods` | `string[]` | `['info', 'warn', 'error', 'debug', 'log', 'trace', 'fatal', 'verbose']` | Method names that make a call on a logger a log call. |

```js
'noctcore-observability/typed-event-names': ['error', {
  eventNamesModule: 'src/log-events.ts',
  eventNamesExport: 'LOG_EVENTS',
}]
```

## When not to use it

If event names are generated at runtime, or come from many modules rather than one list, the rule
cannot check them; leave it off.

## Related

- [`require-event-field`](/eslint-plugins/rules/observability/require-event-field/) requires the
  event field in the first place.
