# `noctcore-nestjs/schedule-states-time-zone`

> A `@Cron` states its `timeZone` and a BullMQ cron schedule states its `tz`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A cron expression names a wall-clock time, and a wall clock needs a zone. Left out, `@Cron` from
`@nestjs/schedule` uses the zone of the process, and so does a BullMQ job scheduler. "Every day at
03:00" then means 03:00 on a developer laptop in Warsaw, 03:00 UTC in the container, and a different
instant again after the clocks change, so the nightly report runs during business hours and nobody
notices until a customer does.

```ts bad
export class ReportsService {
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'nightly-report' })
  async nightly() {}
}
```

```ts good
export class ReportsService {
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'nightly-report', timeZone: 'Europe/Warsaw' })
  async nightly() {}
}
```

## What it flags

- `@Cron(expr)` with no options, or options without a `timeZone` (or `utcOffset`), or with
  `timeZone: undefined`.
- `<x>.upsertJobScheduler(id, spec, template)` whose `spec` has no `tz`, or a `spec` passed by name.
- `<queue>.add(name, data, { repeat: { pattern } })`, the older repeatable-job form, without `tz`.
- With the `zones` option set, any stated zone that is not one of those string literals, a variable
  included.

```ts bad
await this.reportsQueue.upsertJobScheduler('nightly', { pattern: '0 3 * * *' }, { name: 'report' });
await this.reportsQueue.add('report', {}, { repeat: { pattern: '0 3 * * *' } });
```

```ts good
await this.reportsQueue.upsertJobScheduler('nightly', { pattern: '0 3 * * *', tz: 'UTC' }, { name: 'report' });
await this.reportsQueue.add('report', {}, { repeat: { pattern: '0 3 * * *', tz: 'UTC' } });
```

## What it does not flag

- An `every:` interval: it has no wall-clock hour to state.
- A zone stated through a constant (`timeZone: APP_TIME_ZONE`) when `zones` is not set.
- `@Interval` and `@Timeout`, which are durations, and a `CronJob` built by hand through
  `SchedulerRegistry`.
- A decorator named `Cron` from another library: the check is by name.

```ts good
await this.reportsQueue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'ping' });
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `zones` | `string[]` | unset | When set, the zone must be one of these string literals. A variable, `utcOffset` or any other zone is reported. |

```js
'noctcore-nestjs/schedule-states-time-zone': ['error', { zones: ['UTC', 'Europe/Warsaw'] }]
```

```ts bad options={"zones":["UTC"]}
export class ReportsService {
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: SERVER_ZONE })
  async nightly() {}
}
```

```ts good
export class ReportsService {
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async nightly() {}
}
```

## When not to use it

If every process you run is pinned to one zone by its environment (`TZ=UTC` in every image and on
every laptop), the implicit zone is already a decision. Even then, stating it in the schedule costs
one property and survives the day someone runs the worker without that environment.
