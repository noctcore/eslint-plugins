# `noctcore-nestjs/queue-registration-through-define-queue`

> In an app that uses `@noctcore/jobs`, queues come from `defineQueue` and `JobsModule.forFeature`, not from `new Queue(...)` or `BullModule.registerQueue(...)`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`defineQueue(name, policy)` makes every setting BullMQ would leave to a default a required field:
attempts with a jittered backoff, and retention windows for finished jobs. The jobs runtime then
builds the BullMQ queue and worker on the right connections: a fail-fast one for producers and a
patient one for workers. A queue built by hand gets none of it. BullMQ's defaults are one attempt
and finished jobs kept forever, so the first transient error loses a job and Redis grows without a
bound, and nothing about the code looks wrong.

```ts bad
import { JobsModule } from '@noctcore/jobs';
import { Queue } from 'bullmq';

export const mail = new Queue('mail', { connection });
```

```ts good
import { defineQueue, expo } from '@noctcore/jobs';

export const mail = defineQueue<MailJobs>('mail', {
  attempts: 5,
  backoff: expo('2s'),
  keep: { completed: '1h', failed: '7d' },
  concurrency: 5,
});
```

## What it flags

In an app that uses `@noctcore/jobs` (the file imports it, or a `package.json` from the file's
directory up to the workspace root declares it as a dependency of any kind):

- `new Queue(...)`, `new Worker(...)` and `new QueueEvents(...)` imported from `bullmq`, renamed or
  not;
- `BullModule.registerQueue(...)` and `BullModule.registerQueueAsync(...)` from `@nestjs/bullmq`.

```ts bad reports=2
import { JobsModule } from '@noctcore/jobs';
import { BullModule } from '@nestjs/bullmq';
import { Worker } from 'bullmq';

@Module({ imports: [BullModule.registerQueue({ name: 'reports' })] })
export class ReportsModule {}

export const reportWorker = new Worker('reports', buildReport, { connection });
```

```ts good
import { JobsModule } from '@noctcore/jobs';

import { reports } from './queues';

@Module({ imports: [JobsModule.forFeature([reports])], providers: [ReportWorker] })
export class ReportsModule {}
```

## What it does not flag

- `new FlowProducer(...)`: `@noctcore/jobs` has no flows, so a flow producer has nowhere else to come
  from.
- `BullModule.forRoot(...)`, which registers no queue.
- A `Worker` that is not imported from `bullmq`, such as the one from `node:worker_threads`, and a
  namespace import of `bullmq`.
- Any file of a project that does not use `@noctcore/jobs`, and files matched by `allowIn`.

```ts good
import { JobsModule } from '@noctcore/jobs';
import { FlowProducer } from 'bullmq';
import { Worker } from 'node:worker_threads';

export const flows = new FlowProducer({ connection });
export const resize = new Worker('./resize.js');
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` | none | Globs of files the rule skips, such as tests that open a queue to inspect Redis. |

```js
'noctcore-nestjs/queue-registration-through-define-queue': ['error', { allowIn: ['test/**'] }]
```

```ts bad filename=test/mail.e2e-spec.ts
import { JobsModule } from '@noctcore/jobs';
import { Queue } from 'bullmq';

export const probe = new Queue('mail', { connection });
```

```ts good reconfigured options={"allowIn":["test/**"]} filename=test/mail.e2e-spec.ts
import { JobsModule } from '@noctcore/jobs';
import { Queue } from 'bullmq';

export const probe = new Queue('mail', { connection });
```

## When not to use it

If an app runs `@noctcore/jobs` beside queues it keeps on plain BullMQ on purpose (a queue another
service owns, a migration in progress), list those files in `allowIn` or turn the rule off for
them.

## Related

- [`worker-extends-job-host`](./worker-extends-job-host.md) reports NestJS `@Processor` workers in
  the same apps.
- [`no-raw-bullmq-queue-add`](./no-raw-bullmq-queue-add.md) reports jobs added to such queues.
