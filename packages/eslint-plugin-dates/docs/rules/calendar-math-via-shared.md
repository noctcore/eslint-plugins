# `noctcore-dates/calendar-math-via-shared`

> Day and month arithmetic lives in one calendar module with one set of tests.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Calendar arithmetic has edges that every hand-rolled copy works out again on its own: one month
after 31 January, a day added across a daylight saving change, the day an instant falls on just
after midnight, an end date that is exclusive. The UTC accessors are the right tools, which is why
copies spread: each one looks correct, and two of them disagree on an edge nobody tested. The
answers belong in one module, and every other file imports them:

```ts bad filename=src/billing/period.ts options={"allowIn":["**/src/lib/calendar.ts"]}
export function nextPeriodStart(start: Date): Date {
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  return next;
}
```

```ts good filename=src/billing/period.ts options={"allowIn":["**/src/lib/calendar.ts"]}
import { addMonths } from '../lib/calendar';

export function nextPeriodStart(start: Date): Date {
  return addMonths(start, 1);
}
```

## What it flags

Outside the files in `allowIn`, four shapes, each one a `checks` entry:

- **`utcAccessor`**: every `getUTC*` and `setUTC*` call, on any receiver.
- **`dateUtc`**: `Date.UTC(...)`.
- **`setMonth`**: month arithmetic by setter, which overflows (31 January plus one month is
  3 March) in any zone.
- **`msPerDay`**: a day written in milliseconds, as `86400000` (`86_400_000`, `864e5`) or as a
  product whose number factors multiply to it in any order (`24 * 60 * 60 * 1000`,
  `days * 86_400 * 1000`). It assumes every day is 24 hours long, which is false twice a year
  wherever clocks change.

```ts bad filename=src/leave/days.ts options={"allowIn":["**/src/lib/calendar.ts"]} reports=2
export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

export const monthKey = (day: Date) => `${day.getUTCFullYear()}`;
```

## What it does not flag

- Any file matched by `allowIn`.
- Reading an instant: `getTime()`, `toISOString()`, `Date.now()`.
- A `UTC` method on anything but the global `Date` (`moment.utc()`).
- Durations that are not a day (`60 * 60 * 1000`, `30 * 1000`).

```ts good filename=src/lib/calendar.ts options={"allowIn":["**/src/lib/calendar.ts"]} relocation
export function addMonths(day: Date, months: number): Date {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), lastDay)));
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files exempt from the rule (the calendar module and its tests), matched against the forward-slashed filename. A leading `**/` matches any directory prefix. |
| `checks` | `string[]` | all four | The shapes to report: `utcAccessor`, `dateUtc`, `setMonth`, `msPerDay`. |
| `calendarModule` | `string` | none | Import path of your calendar module, named in the message. |

```js
'noctcore-dates/calendar-math-via-shared': ['error', {
  allowIn: ['**/src/lib/calendar.ts'],
  calendarModule: '@acme/shared/calendar',
}]
```

Without `allowIn` the calendar module itself is reported. To scope the rule to part of a repo,
set `files` on the config block that enables it.

## When not to use it

A codebase with no calendar module yet should write one first. Code that uses a day in
milliseconds as a plain duration (a one-day cookie `maxAge`, a cache TTL) either drops `msPerDay`
from `checks` or names the constant in the calendar module.
