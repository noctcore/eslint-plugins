# `noctcore-dates/no-local-calendar-time`

> A calendar day is read in one agreed zone, never in whatever zone the machine is in.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A due date, a birthday or a leave day is a calendar day, not an instant. Once it is stored as a
`Date`, every read has to use the same zone, and the `Date` API makes the machine's zone the easy
default. The same row then shows 31 March on a laptop in Warsaw and 30 March on a CI runner in
UTC or a browser in New York, and the test suite passes on whichever machine wrote it:

```ts bad filename=src/leave/leave-row.ts options={"allowIn":["**/src/lib/calendar.ts"]}
export function leaveLabel(day: Date): string {
  return `${day.getDate()}.${day.getMonth() + 1}.${day.getFullYear()}`;
}
```

```ts good filename=src/leave/leave-row.ts options={"allowIn":["**/src/lib/calendar.ts"]}
import { formatDay } from '../lib/calendar';

export function leaveLabel(day: Date): string {
  return formatDay(day);
}
```

The calendar module answers the question once, in the zone the product agreed on (with
`Intl.DateTimeFormat` and a `timeZone`, or the UTC accessors for a day stored as midnight UTC),
and is the one file in `allowIn`.

## What it flags

Three shapes by default, and a fourth through `checks`:

- **`localAccessor`**: `getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours`, `getMinutes`
  and their setters (`setFullYear` to `setMinutes`), on any receiver, including `d?.getDate()` and
  `d['getDate']()`.
- **`dateOnlyParse`**: `new Date('2026-03-31')` and `Date.parse('2026-03-31')`. A date-only
  string parses as midnight UTC, so a local accessor or formatter reads it as 30 March anywhere
  west of UTC.
- **`isoDaySlice`**: `toISOString().slice(0, 10)`, `.substring(0, 10)`, `.substr(0, 10)` and
  `.split('T')[0]`. That is the UTC day of the instant, so "today" is yesterday in Warsaw just
  after midnight.
- **`instantVsNow`** (opt-in): `due.getTime() < Date.now()` in either order with any ordering
  operator. For a day stored as midnight it says the day is over from its first minute, so a
  deadline is overdue on its own last day.

```ts bad filename=src/leave/today.ts options={"allowIn":["**/src/lib/calendar.ts"]} reports=2
export const today = new Date().toISOString().slice(0, 10);
export const firstDay = new Date('2026-01-01');
```

```ts bad filename=src/tasks/overdue.ts options={"checks":["instantVsNow"]}
export const isOverdue = (task: { dueAt: Date }) => task.dueAt.getTime() < Date.now();
```

## What it does not flag

- Any file matched by `allowIn`.
- The UTC accessors (`getUTCDate()`), which
  [`calendar-math-via-shared`](./calendar-math-via-shared.md) covers.
- A full timestamp with its zone (`new Date('2026-03-31T08:00:00Z')`), the year, month and day
  constructor, and `toISOString()` kept whole or cut somewhere else.
- `getTime()` against `Date.now()` unless `instantVsNow` is on, and with it, equality and
  arithmetic (`Date.now() - start.getTime()`).

```ts good filename=src/lib/calendar.ts options={"allowIn":["**/src/lib/calendar.ts"]} relocation
const WARSAW = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short' });

export const formatDay = (day: Date): string => WARSAW.format(day);
export const dayOfMonth = (day: Date): number => day.getDate();
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files exempt from the rule (the calendar module and its tests), matched against the forward-slashed filename. A leading `**/` matches any directory prefix. |
| `checks` | `string[]` | `["localAccessor", "dateOnlyParse", "isoDaySlice"]` | The shapes to report. Add `instantVsNow` when every `Date` compared with the clock in scope is a calendar day. |
| `calendarModule` | `string` | none | Import path of your calendar module, named in the message. |

```js
'noctcore-dates/no-local-calendar-time': ['error', {
  allowIn: ['**/src/lib/calendar.ts'],
  calendarModule: '@acme/shared/calendar',
}]
```

To scope the rule to part of a repo, set `files` on the config block that enables it.

A codebase that stores every calendar day as a midnight-UTC key reads it with the UTC accessors,
creates it with `new Date('2026-03-31')` and formats it with `toISOString().slice(0, 10)`, all
correctly. There, `checks: ['localAccessor', 'instantVsNow']` keeps the two shapes that are wrong
for such a key and drops the two that are its convention.

## When not to use it

A codebase whose dates are all instants (log stamps, token expiries, `getHours()` for a greeting)
has no calendar days to protect. Scope the rule with `files` to the code that handles days, or
leave it off.
