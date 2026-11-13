# `noctcore-nestjs/queue-options-must-set-retention`

> Every BullMQ job a producer enqueues states `removeOnComplete` and `removeOnFail`, in its options or its queue's `defaultJobOptions`.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

BullMQ keeps every completed and every failed job in Redis unless the job or its queue says to
remove it. On a busy queue that is a slow leak: the keys pile up, memory grows, and the dashboard
fills with jobs nobody will look at again:

```ts bad
export class ReportService {
  constructor(private readonly reportQueue: Queue) {}

  async request(reportId: string) {
    await this.reportQueue.add(JOBS.BUILD, { reportId });
  }
}
```

Stating both keys makes the retention a decision. Keep what you need, drop the rest:

```ts good
export class ReportService {
  constructor(private readonly reportQueue: Queue) {}

  async request(reportId: string) {
    await this.reportQueue.add(JOBS.BUILD, { reportId }, {
      removeOnComplete: { age: 3600 },
      removeOnFail: 1000,
    });
  }
}
```

The choice can also live on the queue, once, when the file constructs it:

```ts good
import { Queue } from 'bullmq';

const reportQueue = new Queue('reports', {
  connection,
  defaultJobOptions: { removeOnComplete: { age: 3600 }, removeOnFail: 1000 },
});

export async function requestReport(reportId: string) {
  await reportQueue.add(JOBS.BUILD, { reportId });
}
```

`false` is a valid answer too: it writes down that finished jobs are kept on purpose.

## What it flags

A call on a receiver whose name matches `queuePattern` (default: contains `queue`, so
`this.queue`, `emailQueue`, `this.billingQueue`), with the call's options laid over the
`defaultJobOptions` of the bullmq `new Queue(...)` stored in that same binding in the file, key by
key:

- `<queue>.add(name, data)` or `<queue>.add(name, data, options)` where neither the options nor the
  queue defaults set a key of `require` (a value of `undefined` counts as not set).

A call gets one report, naming every key it is missing, placed on the options literal or on the
call when it has none. A queue constructed later in the file than the call still counts.

```ts bad
await this.mailQueue.add(JOBS.WELCOME, { userId });
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 3 });
await this.mailQueue.add(JOBS.WELCOME, { userId }, { removeOnComplete: true });
```

## What it does not flag

- Retention set where this rule cannot see it: `defaultJobOptions` in
  `BullModule.registerQueue(...)` or `BullModule.forRoot(...)`, a shared queue factory, or a
  `new Queue(...)` in another file. Set the keys per call, or turn the rule off for those files.
- `addBulk`, and `add` calls shaped for a `FlowProducer` (a flow object as the first argument).
- Options passed by name instead of an object literal, and a queue whose options or
  `defaultJobOptions` are not an object literal. The rule cannot read them, so it stays quiet
  rather than guess.
- An options literal holding a spread, or a `defaultJobOptions` holding one: the spread may supply
  the key.
- A binding that two queues are stored in: the rule cannot tell which one the call uses.
- An explicit `false`, for either key.
- Calls on receivers that do not look like a queue: `set.add(value)`, `this.repository.add(...)`.

```ts good
await this.mailQueue.add(JOBS.WELCOME, { userId }, { removeOnComplete: true, removeOnFail: true });
await this.mailQueue.add(JOBS.AUDIT, { userId }, { removeOnComplete: false, removeOnFail: false });
await this.mailQueue.add(JOBS.DIGEST, { userId }, jobOptions);
await this.mailQueue.add(JOBS.DIGEST, { userId }, { ...retentionPolicy });
await this.mailQueue.addBulk(users.map((user) => ({ name: JOBS.WELCOME, data: { id: user.id } })));
seen.add(userId);
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` (regular expression, case-insensitive) | `'queue'` | A receiver (`this.<name>` or a bare `<name>`) whose name matches counts as a BullMQ queue. |
| `require` | `('removeOnComplete' \| 'removeOnFail')[]` | both | The keys every job must state, in its options or its queue defaults. |

```js
'noctcore-nestjs/queue-options-must-set-retention': ['error', { queuePattern: 'queue', require: ['removeOnComplete', 'removeOnFail'] }]
```

With `require: ['removeOnFail']`, a job only has to state how long failed jobs stay:

```ts bad options={"require":["removeOnFail"]}
await this.mailQueue.add(JOBS.WELCOME, { userId }, { removeOnComplete: true });
```

```ts good options={"require":["removeOnFail"]}
await this.mailQueue.add(JOBS.WELCOME, { userId }, { removeOnFail: 1000 });
```

## When not to use it

When your queues get their retention somewhere this rule cannot see: `defaultJobOptions` in
`BullModule.registerQueue(...)` or `BullModule.forRoot(...)`, a shared queue factory, or a
`new Queue(...)` in another file. The rule only reads a `new Queue(...)` imported from `bullmq` and
stored in the binding the call goes through, in the same file, so every `add` on an injected
`@InjectQueue` queue would be reported even though its queue already cleans up. It is also a poor
fit when queues are passed around under names that do not say "queue" and you do not want to tune
`queuePattern`.

## Related

- [`job-options-must-set-attempts`](/eslint-plugins/rules/nestjs/job-options-must-set-attempts/)
  reads the same queue defaults to ask every job for `attempts` and a `backoff`.
- [`queue-add-requires-dedup-key`](/eslint-plugins/rules/nestjs/queue-add-requires-dedup-key/)
  polices the same `add` calls for a dedup key.
