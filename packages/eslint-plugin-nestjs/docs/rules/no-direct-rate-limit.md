# `noctcore-nestjs/no-direct-rate-limit`

> In an app that uses `@noctcore/jobs`, a queue is paused through `pauseQueue` or `pauseFor`, never with BullMQ's `rateLimit()` or `Worker.RateLimitError()`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

BullMQ keeps one key per queue for both its limiter window and a pause, and `rateLimit(ms)`
replaces it with the new expiry. Two refusals asking for different waits, fifteen minutes because a
provider's quota is spent and one second because of a burst, leave whichever was written last, so
the short pause cuts the long one and the queue hammers the provider again. `@noctcore/jobs` pauses
through one `QueuePause` per queue, which reads the time left first and only ever makes a pause
longer: `throw await this.pauseQueue(ms)` in a `JobHost`, or `queue.pauseFor(ms)` on a `JobQueue`.

```ts bad
import { JobQueue } from '@noctcore/jobs';
import { Worker } from 'bullmq';

export async function backOff(queue: JobQueue) {
  await queue.bull.rateLimit(5000);
  throw Worker.RateLimitError();
}
```

```ts good
import { JobHost, Worker } from '@noctcore/jobs';

import { mail } from './queues';

@Worker(mail)
export class MailWorker extends JobHost<typeof mail> {
  async handle(job) {
    const response = await relay.send(job.data);
    if (response.status === 429) throw await this.pauseQueue(5000);
  }
}
```

## What it flags

In an app that uses `@noctcore/jobs` (the file imports it, or a `package.json` from the file's
directory up to the workspace root declares it as a dependency of any kind):

- `.rateLimit(...)` on `x.bull` and on a receiver the file shows to be a BullMQ queue or worker:
  built with `new Queue(...)` or `new Worker(...)` from `bullmq`, injected with `@InjectQueue(...)`
  from `@nestjs/bullmq`, annotated `Queue` or `Worker` from `bullmq`, or `this.worker` in a class
  extending NestJS's `WorkerHost`;
- `Worker.RateLimitError()` on the `Worker` from `bullmq`, and `new RateLimitError()` from `bullmq`.

```ts bad reports=2
import { JobsModule } from '@noctcore/jobs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Worker } from 'bullmq';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  async process(job) {
    await this.worker.rateLimit(5000);
    throw Worker.RateLimitError();
  }
}
```

```ts good
import { JobHost, Worker } from '@noctcore/jobs';

import { mail } from './queues';

@Worker(mail)
export class MailProcessor extends JobHost<typeof mail> {
  async handle(job) {
    throw await this.pauseQueue(5000);
  }
}
```

## What it does not flag

- `pauseQueue(ms)` and `pauseFor(ms)`.
- `.rateLimit(...)` on a receiver the file says nothing about, such as a rate limiter of your own.
- A `RateLimitError` that is not from `bullmq`, including a call on the `Worker` decorator from
  `@noctcore/jobs`.
- Any file of a project that does not use `@noctcore/jobs`, and files matched by `allowIn`.

```ts good
import { JobQueue } from '@noctcore/jobs';

export async function slowDown(queue: JobQueue, limiter) {
  await limiter.rateLimit(5000);
  return queue.pauseFor(60_000);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` | none | Globs of files the rule skips. |

```js
'noctcore-nestjs/no-direct-rate-limit': ['error', { allowIn: ['src/admin/**'] }]
```

```ts bad filename=src/admin/limits.ts
import { JobQueue } from '@noctcore/jobs';

export function hold(queue: JobQueue) {
  return queue.bull.rateLimit(60_000);
}
```

```ts good reconfigured options={"allowIn":["src/admin/**"]} filename=src/admin/limits.ts
import { JobQueue } from '@noctcore/jobs';

export function hold(queue: JobQueue) {
  return queue.bull.rateLimit(60_000);
}
```

## When not to use it

If a queue's pause is owned by something outside the jobs runtime (an admin tool that sets a fixed
stop on purpose), list that file in `allowIn`.

## Related

- [`worker-extends-job-host`](./worker-extends-job-host.md): `pauseQueue` is a `JobHost` method.
