# `noctcore-nestjs/job-options-must-set-attempts`

> Every BullMQ job a producer enqueues states its `attempts`, and a `backoff` when it retries, in its options or its queue's `defaultJobOptions`.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

BullMQ runs a job once unless it is told otherwise. One transient failure (a database timeout, a
deploy that restarts the worker mid-job, a third-party API that blinks) moves the job to `failed`
and nothing runs it again:

```ts bad
export class ReportService {
  constructor(private readonly reportQueue: Queue) {}

  async request(reportId: string) {
    await this.reportQueue.add(JOBS.BUILD, { reportId });
  }
}
```

Stating `attempts` turns that failure into a retry. Give it a `backoff` as well, so the retries are
spread out instead of firing at once into the same outage:

```ts good
export class ReportService {
  constructor(private readonly reportQueue: Queue) {}

  async request(reportId: string) {
    await this.reportQueue.add(JOBS.BUILD, { reportId }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }
}
```

The choice can also live on the queue, once, when the file constructs it:

```ts good
import { Queue } from 'bullmq';

const reportQueue = new Queue('reports', {
  connection,
  defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 } },
});

export async function requestReport(reportId: string) {
  await reportQueue.add(JOBS.BUILD, { reportId });
}
```

`attempts: 1` is a valid answer too: it writes down that the job must not run twice.

## What it flags

A call on a receiver whose name matches `queuePattern` (default: contains `queue`, so
`this.queue`, `emailQueue`, `this.billingQueue`), with the call's options laid over the
`defaultJobOptions` of the bullmq `new Queue(...)` stored in that same binding in the file, key by
key:

- `<queue>.add(name, data)` or `<queue>.add(name, data, options)` where neither the options nor the
  queue defaults set `attempts` (a value of `undefined` counts as not set);
- with `requireBackoff` on (the default), an `attempts` written as a number other than `1` with no
  `backoff` in the options or the queue defaults;
- each job object of `<queue>.addBulk([...])` (an object literal with `data` that is an element of
  the list, or what a `map` / `flatMap` callback returns for it), checked on its own `opts`, or on
  the queue defaults alone when it has no `opts`. Options or `opts` written as `undefined` count as
  none.

```ts bad
await this.mailQueue.add(JOBS.WELCOME, { userId }, { priority: 1 });
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 3 });
await this.mailQueue.addBulk(users.map((user) => ({ name: JOBS.WELCOME, data: { id: user.id } })));
```

## What it does not flag

- Calls on a `FlowProducer`: a receiver stored from a bullmq `new FlowProducer(...)` in the file, an
  `add` whose first argument is a flow object, and `addBulk` jobs that name a `queueName` or
  `children`.
- Options passed by name instead of an object literal, job `opts` passed by name, and an `addBulk`
  argument that is not built from object literals here. The rule cannot read them, so it stays
  quiet rather than guess.
- An object literal with a `data` key that is not itself an element of the `addBulk` list: a
  job's own payload (`data: { data: ... }`) or an object handed to a helper call
  (`addBulk(buildJobs(ids, { data }))`).
- An options literal holding a spread when the key it needs is missing: the spread may supply it.
  The same holds for a spread in the queue's options or in its `defaultJobOptions`.
- An `attempts` that is not a number literal (`attempts: MAX_ATTEMPTS`): the rule cannot know it
  is above 1, so it asks for no `backoff` either.
- Calls on receivers that do not look like a queue: `set.add(value)`, `this.repository.add(...)`.

```ts good
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
await this.mailQueue.add(JOBS.RECEIPT, { userId }, { attempts: 1 });
await this.mailQueue.add(JOBS.DIGEST, { userId }, { attempts: MAX_ATTEMPTS });
await this.mailQueue.add(JOBS.DIGEST, { userId }, jobOptions);
await this.mailQueue.addBulk(
  users.map((user) => ({ name: JOBS.WELCOME, data: { id: user.id }, opts: { ...retryPolicy } })),
);
seen.add(userId);
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` (regular expression, case-insensitive) | `'queue'` | A receiver (`this.<name>` or a bare `<name>`) whose name matches counts as a BullMQ queue. |
| `requireBackoff` | `boolean` | `true` | A number `attempts` other than `1` must also come with a `backoff`, in the options or the queue defaults. |

```js
'noctcore-nestjs/job-options-must-set-attempts': ['error', { queuePattern: 'queue', requireBackoff: true }]
```

With `requireBackoff: false`, a job only has to state `attempts`:

```ts bad options={"requireBackoff":false}
await this.mailQueue.add(JOBS.WELCOME, { userId });
```

```ts good options={"requireBackoff":false}
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 5 });
```

## When not to use it

When your queues get their retry policy somewhere this rule cannot see: `defaultJobOptions` in
`BullModule.registerQueue(...)` or `BullModule.forRoot(...)`, a shared queue factory, or a
`new Queue(...)` in another file. The rule only reads a `new Queue(...)` imported from `bullmq` and
stored in the binding the call goes through, in the same file, so every `add` on an injected
`@InjectQueue` queue would be reported even though its queue already retries. It is also a poor fit
when queues are passed around under names that do not say "queue" and you do not want to tune
`queuePattern`.

## Related

- [`queue-add-requires-dedup-key`](/eslint-plugins/rules/nestjs/queue-add-requires-dedup-key/)
  polices the same `add` calls for a dedup key, which a retried producer needs as much as a retried
  job needs `attempts`.
