# `noctcore-nestjs/worker-must-implement-close`

> A class that creates a BullMQ `Worker` in a field closes it in a shutdown method.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A BullMQ worker holds a Redis connection and a lock on every job it is running. When the process
shuts down without `await worker.close()`, those jobs are abandoned mid-flight: their locks expire,
BullMQ marks them stalled, and another worker runs them again from the start. A deploy then sends
the same email twice or charges the same card twice, and the dropped connection shows up as
errors on the Redis side. `close()` stops taking new jobs and waits for the running ones to finish.

In NestJS the place for it is `onModuleDestroy` (or `onApplicationShutdown`), which Nest calls on
shutdown when `app.enableShutdownHooks()` is on.

```ts bad
import { Worker } from 'bullmq';

export class MailWorker {
  private worker = new Worker('mail', sendMail, { connection });
}
```

```ts good
import { Worker } from 'bullmq';

export class MailWorker {
  private worker = new Worker('mail', sendMail, { connection });

  async onModuleDestroy() {
    await this.worker.close();
  }
}
```

## What it flags

- A class whose instance field is initialised with a `new Worker(...)` imported from `bullmq`, or
  that assigns `this.<field> = new Worker(...)` in one of its methods (the constructor included),
  when none of its close methods calls `this.<field>.close()`.
- A close method that exists but never closes that worker, for example one that only logs, or
  closes a queue and forgets the worker.

```ts bad
import { Queue, Worker } from 'bullmq';

export class MailWorker {
  private queue = new Queue('mail', { connection });
  private worker!: Worker;

  onModuleInit() {
    this.worker = new Worker('mail', sendMail, { connection });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
```

```ts good
import { Queue, Worker } from 'bullmq';

export class MailWorker {
  private queue = new Queue('mail', { connection });
  private worker!: Worker;

  onModuleInit() {
    this.worker = new Worker('mail', sendMail, { connection });
  }

  async onModuleDestroy() {
    await Promise.all([this.worker.close(), this.queue.close()]);
  }
}
```

## What it does not flag

- A NestJS `@Processor` class extending `WorkerHost`: Nest creates and closes that worker, so the
  class owns none.
- A close call anywhere in a close method's body: awaited or not, inside `Promise.all`, or through
  `this.worker?.close()`.
- A worker held in a local variable, an array, a map, a static field or a `#private` field. Only
  plain instance fields are tracked.
- `this.worker = new Worker(...)` inside a plain nested `function`, where `this` is not the class.
- A `Worker` that is not imported from `bullmq`, such as the one from `node:worker_threads`. A
  renamed import (`import { Worker as BullWorker } from 'bullmq'`) is followed; a namespace import
  or `require('bullmq')` is not.

```ts good
import { Processor, WorkerHost } from '@nestjs/bullmq';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  async process(job) {
    await sendMail(job.data);
  }
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `closeMethodNames` | `string[]` | `close`, `shutdown`, `dispose`, `onModuleDestroy`, `onApplicationShutdown`, `beforeApplicationShutdown` | Methods one of which must call `this.<field>.close()`. Replaces the defaults, so list every name you use. |

```js
'noctcore-nestjs/worker-must-implement-close': ['error', { closeMethodNames: ['stop'] }]
```

```ts bad options={"closeMethodNames":["stop"]}
import { Worker } from 'bullmq';

export class MailWorker {
  private worker = new Worker('mail', sendMail, { connection });

  async onModuleDestroy() {
    await this.worker.close();
  }
}
```

```ts good options={"closeMethodNames":["stop"]}
import { Worker } from 'bullmq';

export class MailWorker {
  private worker = new Worker('mail', sendMail, { connection });

  async stop() {
    await this.worker.close();
  }
}
```

## When not to use it

If your workers are closed from outside the class that creates them, for example by a shutdown
coordinator that collects every worker and closes them together, the rule reports each class.
Name the method the coordinator calls in `closeMethodNames` and close the worker there, or turn
the rule off for those files.
