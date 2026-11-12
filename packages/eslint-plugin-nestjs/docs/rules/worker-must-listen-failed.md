# `noctcore-nestjs/worker-must-listen-failed`

> Every BullMQ `new Worker(...)` has a `.on('failed', ...)` listener in the same file.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

When a BullMQ job throws, the worker moves it to the failed set, retries it if it has attempts left,
and emits a `failed` event. That event is the only signal. With no listener, nothing reaches the
logs or the error tracker: the email is never sent, the invoice is never generated, and the first
person to notice is the customer who asks where it went.

```ts bad
import { Worker } from 'bullmq';

const mailWorker = new Worker('mail', sendMail, { connection });
```

```ts good
import { Worker } from 'bullmq';

const mailWorker = new Worker('mail', sendMail, { connection });
mailWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'mail job failed'));
```

## What it flags

- A `new Worker(...)` bound to a name (`const worker`, `this.worker =`, or a class field
  `private worker = new Worker(...)`) when no `<name>.on('failed', ...)` appears anywhere in the
  file.
- A `new Worker(...)` written as a bare statement with no `.on('failed', ...)` chained on it:
  nothing can ever subscribe to it.
- With `requiredEvents`, each listed event that has no listener.

```ts bad
import { Worker } from 'bullmq';

export class MailService {
  private worker = new Worker('mail', sendMail, { connection });

  onModuleInit() {
    this.worker.on('completed', (job) => logger.info({ jobId: job.id }, 'mail sent'));
  }
}
```

```ts good
import { Worker } from 'bullmq';

export class MailService {
  private worker = new Worker('mail', sendMail, { connection });

  onModuleInit() {
    this.worker.on('completed', (job) => logger.info({ jobId: job.id }, 'mail sent'));
    this.worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'mail failed'));
  }
}
```

## What it does not flag

- A listener chained on the constructor: `new Worker(...).on('failed', ...)`, alone or after other
  `.on(...)` calls.
- A listener attached anywhere in the file, before or after the worker, in any method of the class.
- A worker that is returned, passed to a function, or stored in another variable, object or array:
  the listener can be attached where it ends up.
- A NestJS `@Processor` class extending `WorkerHost`: Nest builds that worker, so there is no
  `new Worker(...)` to check, and an `@OnWorkerEvent('failed')` method is how it listens.
- A `Worker` that is not imported from `bullmq`, such as the one from `node:worker_threads`, a
  local class of the same name, or a parameter that shadows the import. A renamed import
  (`import { Worker as BullWorker } from 'bullmq'`) is followed.
- A namespace import (`import * as bullmq from 'bullmq'`) or `require('bullmq')`.
- `.once('failed', ...)` and `.addListener('failed', ...)`: only `.on` counts, since `once` hears
  one failure.

```ts good
import { Worker } from 'bullmq';

export function createMailWorker() {
  return new Worker('mail', sendMail, { connection });
}

new Worker('reports', buildReport, { connection }).on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'report failed');
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requiredEvents` | `string[]` | `['failed']` | Events each worker needs a `.on(event, ...)` listener for. Replaces the default, so list `failed` too. |

```js
'noctcore-nestjs/worker-must-listen-failed': ['error', { requiredEvents: ['failed', 'error'] }]
```

```ts bad options={"requiredEvents":["failed","error"]}
import { Worker } from 'bullmq';

const mailWorker = new Worker('mail', sendMail, { connection });
mailWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'mail job failed'));
```

```ts good options={"requiredEvents":["failed","error"]}
import { Worker } from 'bullmq';

const mailWorker = new Worker('mail', sendMail, { connection });
mailWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'mail job failed'));
mailWorker.on('error', (err) => logger.error({ err }, 'mail worker error'));
```

## When not to use it

If your workers are built in one module and every listener is attached in another (a shared
`instrumentWorker(worker)` helper is fine, since passing the worker counts), the rule cannot see
across files and reports the worker. Export it through a function that attaches the listener, or
turn the rule off for that module. If failures are observed some other way, such as a
`QueueEvents` listener in a separate process, the rule reports workers you consider covered; turn
it off in that case.
