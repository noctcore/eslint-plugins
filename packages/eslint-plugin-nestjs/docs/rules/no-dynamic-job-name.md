# `noctcore-nestjs/no-dynamic-job-name`

> The job name of `add()` on a `@noctcore/jobs` queue and the name of a `@Sweep()` are fixed strings, not built at run time.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A `@noctcore/jobs` queue is typed by a map of job names to payloads, and its worker branches on
`job.name`. A name built at run time matches no entry of that map, so no branch handles it, and it
splits the `job` label of the job metrics into one series per value. The varying part belongs in the
job data.

```ts bad
import { dedupe } from '@noctcore/jobs';

export async function notify(queue, kind: string, data) {
  await queue.add(`send-${kind}`, data, { dedupe: dedupe.none() });
}
```

```ts good
import { dedupe } from '@noctcore/jobs';

export async function notify(queue, kind: string, data) {
  await queue.add('send', { kind, ...data }, { dedupe: dedupe.none() });
}
```

For a sweep the stakes are higher: the name is the id of its BullMQ job scheduler. A name that
differs between deploys or between replicas gives each boot a different scheduler, and the boot-time
reconcile of each replica removes the scheduler the other one made.

## What it flags

A job name passed as the first argument of `add(name, data, ...)` on a `@noctcore/jobs` queue, or a
name passed to `@Sweep()` from `@noctcore/jobs`, that is built at run time:

- a template literal with substitutions;
- a `+` concatenation;
- a call (`String(kind)`, `parts.join('-')`, `nameFor(kind)`);
- a `process.env` read;
- a conditional or logical expression with one of the above on either side.

A queue is recognised the way the other `@noctcore/jobs` rules recognise it: a receiver the file
declares as a `JobQueue` (an `@InjectQueue(queue)` parameter from `@noctcore/jobs`, or a `JobQueue`
annotation), or, when the file says nothing about it, a receiver whose name matches `queuePattern`
(`this.queue`, `mailQueue`).

```ts bad
import { InjectQueue, JobQueue, Sweep, dedupe } from '@noctcore/jobs';

import { mail } from './queues';

export class MailService {
  constructor(@InjectQueue(mail) private readonly mail: JobQueue<typeof mail>) {}

  send(kind: string) {
    return this.mail.add('send-' + kind, {}, { dedupe: dedupe.none() });
  }

  @Sweep(`cleanup-${process.env.REGION}`, { every: '1h' })
  async cleanup() {}
}
```

```ts good
import { InjectQueue, JobQueue, Sweep, dedupe } from '@noctcore/jobs';

import { mail } from './queues';

export class MailService {
  constructor(@InjectQueue(mail) private readonly mail: JobQueue<typeof mail>) {}

  send(kind: string) {
    return this.mail.add('send', { kind }, { dedupe: dedupe.none() });
  }

  @Sweep('cleanup', { every: '1h' })
  async cleanup() {}
}
```

## What it does not flag

- A name whose value is known statically: a literal, a template with no substitutions, a `const`
  holding a string, or a conditional between two literals.
- An identifier or a member access, such as a constant (`JOBS.send`) or a parameter typed as one of
  the map's names (`name: N` with `N extends keyof MailJobs`): it names one value of the map.
- A file that does not import `@noctcore/jobs`.
- `add()` on a BullMQ queue (`queue.bull.add(...)`, a receiver annotated `Queue` from `bullmq`):
  [`no-raw-bullmq-queue-add`](./no-raw-bullmq-queue-add.md) reports those.
- An `add` with fewer than two arguments, which is not an enqueue (a `Set`, a task queue).

```ts good
import { dedupe } from '@noctcore/jobs';

const SEND = 'send';

export function enqueue<N extends keyof MailJobs>(queue, name: N, data: MailJobs[N]) {
  return queue.add(name, data, { dedupe: dedupe.none() });
}

export function sendNow(queue, urgent: boolean, data) {
  queue.add(SEND, data, { dedupe: dedupe.none() });
  return queue.add(urgent ? 'send-now' : 'send', data, { dedupe: dedupe.none() });
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` | `'queue'` | Case-insensitive regular expression a receiver name must match to count as a queue when the file does not declare it as a `JobQueue`. |

```js
'noctcore-nestjs/no-dynamic-job-name': ['error', { queuePattern: 'queue|outbox' }]
```

```ts bad options={"queuePattern":"queue|outbox"}
import { dedupe } from '@noctcore/jobs';

export function relay(outbox, kind: string, data) {
  return outbox.add(`relay-${kind}`, data, { dedupe: dedupe.none() });
}
```

```ts good options={"queuePattern":"queue|outbox"}
import { dedupe } from '@noctcore/jobs';

export function relay(outbox, kind: string, data) {
  return outbox.add('relay', { kind, ...data }, { dedupe: dedupe.none() });
}
```

## When not to use it

If your queues are not on `@noctcore/jobs`, the rule does nothing. If a queue really needs one job
name per tenant or per kind (a job map built from a list at run time), the names cannot be fixed;
turn the rule off for that file.

## Related

- [`job-name-must-be-constant`](./job-name-must-be-constant.md), an opt-in convention, goes further
  and reports inline literals too, asking for shared constants. A constant satisfies both rules.
