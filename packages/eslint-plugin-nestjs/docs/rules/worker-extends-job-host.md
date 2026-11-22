# `noctcore-nestjs/worker-extends-job-host`

> A class decorated with `@Worker(queue)` from `@noctcore/jobs` extends `JobHost`, and an app that uses `@noctcore/jobs` has no NestJS `@Processor` workers.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`@Worker(queue)` from `@noctcore/jobs` returns a plain `ClassDecorator`, so TypeScript accepts it on
any class. The jobs runtime only finds out at boot, when it refuses the class and the app does not
start. Until that deploy nothing says the worker is wrong. `JobHost` is what wraps each attempt of
`handle(job)` in the producer's context and a span, records its duration and failures, and calls
`onFinalFailure` once when a job fails for good.

```ts bad
import { Worker } from '@noctcore/jobs';

import { mail } from './queues';

@Worker(mail)
export class MailWorker {
  async process(job) {
    await sendMail(job.data);
  }
}
```

```ts good
import { JobHost, Worker } from '@noctcore/jobs';

import { mail } from './queues';

@Worker(mail)
export class MailWorker extends JobHost<typeof mail> {
  async handle(job) {
    await sendMail(job.data);
  }
}
```

## What it flags

- A class decorated with `@Worker(...)` imported from `@noctcore/jobs` (renamed or not) that has no
  base class, whose chain of base classes declared in the same file never reaches `JobHost`, or that
  extends NestJS's `WorkerHost`.
- In an app that uses `@noctcore/jobs`, a class decorated with `@Processor(...)` from
  `@nestjs/bullmq`, or a class extending its `WorkerHost`. Such a worker runs outside the jobs
  runtime: no queue policy, no context, no tracing, no graceful drain. "Uses `@noctcore/jobs`"
  means the file imports it, or a `package.json` from the file's directory up to the workspace root
  declares it as a dependency of any kind.

```ts bad
import { JobHost } from '@noctcore/jobs';
import { Processor, WorkerHost } from '@nestjs/bullmq';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  async process(job) {
    await sendMail(job.data);
  }
}
```

```ts good
import { JobHost, Worker } from '@noctcore/jobs';

import { mail } from './queues';

@Worker(mail)
export class MailProcessor extends JobHost<typeof mail> {
  async handle(job) {
    await sendMail(job.data);
  }
}
```


### Reads `package.json`

Whether a file belongs to an app that uses `@noctcore/jobs` is decided from the file's imports and
from the `package.json` files between its directory and the workspace root. ESLint's `--cache` does
not see an edit to a `package.json`, so a cached file keeps its old result until it changes; see
[rules that read other files](https://noctcore.github.io/eslint-plugins/filesystem-rules/).

## What it does not flag

- A class that extends `JobHost` through a base class declared in the same file.
- A class whose base class comes from another module: that base may extend `JobHost` where the rule
  cannot see.
- A `Worker` decorator that is not imported from `@noctcore/jobs`, or a local binding that shadows
  the import. A namespace import (`import * as jobs from '@noctcore/jobs'`) is not followed.
- A NestJS `@Processor` in a project that does not use `@noctcore/jobs`.

```ts good
import { JobHost, Worker } from '@noctcore/jobs';

import { BaseWorker } from './base-worker';
import { mail, reports } from './queues';

abstract class AuditedWorker<Q> extends JobHost<Q> {}

@Worker(mail)
export class MailWorker extends AuditedWorker<typeof mail> {
  async handle(job) {
    await sendMail(job.data);
  }
}

@Worker(reports)
export class ReportWorker extends BaseWorker<typeof reports> {
  async handle(job) {
    await buildReport(job.data);
  }
}
```

## When not to use it

If an app is moving from `@nestjs/bullmq` to `@noctcore/jobs` one queue at a time, the `@Processor`
classes still to move are reported. Turn the rule off for those files until they move, rather than
for the whole app, so a new `@Worker` class is still checked.

## Related

- [`queue-registration-through-define-queue`](/eslint-plugins/rules/nestjs/queue-registration-through-define-queue/) reports
  the BullMQ queues and workers such an app builds by hand.
