# `noctcore-nestjs/no-raw-bullmq-queue-add`

> In an app that uses `@noctcore/jobs`, jobs are enqueued through a `JobQueue`, never with `.add()` on a BullMQ `Queue`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`JobQueue.add()` does three things on every call that a raw BullMQ `add` skips. It stamps the job
context envelope, so the worker's logs and spans carry the request that caused the job. It dedupes
through `dedupe.*`, with hashed keys whose window does not depend on how long finished jobs are
kept, instead of a caller-built `jobId`. And it fails fast: while Redis is down it rejects at once,
where a raw add waits for the connection and hangs the caller for the whole outage.

```ts bad
import { InjectQueue, JobQueue } from '@noctcore/jobs';

import { orders } from './queues';

export class OrderService {
  constructor(@InjectQueue(orders) private readonly queue: JobQueue<typeof orders>) {}

  place(id: string, data) {
    return this.queue.bull.add('place', data, { jobId: id });
  }
}
```

```ts good
import { InjectQueue, JobQueue, dedupe } from '@noctcore/jobs';

import { orders } from './queues';

export class OrderService {
  constructor(@InjectQueue(orders) private readonly queue: JobQueue<typeof orders>) {}

  place(id: string, data) {
    return this.queue.add('place', data, { dedupe: dedupe.until(['order', id]) });
  }
}
```

## What it flags

`.add()` and `.addBulk()` called on:

- `x.bull`, the BullMQ queue under a `JobQueue`;
- a receiver the file shows to be a BullMQ queue: built with `new Queue(...)` from `bullmq` (stored
  in a variable or a field, renamed import or not), injected with `@InjectQueue(...)` from
  `@nestjs/bullmq`, or annotated `Queue` from `bullmq`.

Only in an app that uses `@noctcore/jobs`: the file imports it, or a `package.json` from the file's
directory up to the workspace root declares it as a dependency of any kind.

```ts bad
import { InjectQueue } from '@nestjs/bullmq';
import { dedupe } from '@noctcore/jobs';
import type { Queue } from 'bullmq';

export class ReportService {
  constructor(@InjectQueue('reports') private readonly reports: Queue) {}

  build(day: string) {
    return this.reports.add('build', { day });
  }
}
```

```ts good
import { InjectQueue, JobQueue, dedupe } from '@noctcore/jobs';

import { reports } from './queues';

export class ReportService {
  constructor(@InjectQueue(reports) private readonly reports: JobQueue<typeof reports>) {}

  build(day: string) {
    return this.reports.add('build', { day }, { dedupe: dedupe.window(['report', day], '1h') });
  }
}
```


### Reads `package.json`

Whether a file belongs to an app that uses `@noctcore/jobs` is decided from the file's imports and
from the `package.json` files between its directory and the workspace root. ESLint's `--cache` does
not see an edit to a `package.json`, so a cached file keeps its old result until it changes; see
[rules that read other files](https://noctcore.github.io/eslint-plugins/filesystem-rules/).

## What it does not flag

- Reads through `x.bull` (`getJob`, `getWaitingCount`): that is what it is exposed for.
- A receiver the file says nothing about, even one named like a queue: the rule does not guess.
- `FlowProducer.add(...)`: `@noctcore/jobs` has no flows.
- A `Queue` that is not imported from `bullmq`, and a namespace import of `bullmq`.
- Any file of a project that does not use `@noctcore/jobs`.
- Files matched by `allowIn`.

```ts good
import { InjectQueue, JobQueue } from '@noctcore/jobs';

import { orders } from './queues';

export class OrderStats {
  constructor(@InjectQueue(orders) private readonly queue: JobQueue<typeof orders>) {}

  waiting() {
    return this.queue.bull.getWaitingCount();
  }
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` | none | Globs of files the rule skips, such as seed scripts or tests that drive BullMQ directly. |

```js
'noctcore-nestjs/no-raw-bullmq-queue-add': ['error', { allowIn: ['scripts/**', '**/*.e2e-spec.ts'] }]
```

```ts bad filename=scripts/seed.ts
import { dedupe } from '@noctcore/jobs';

export function seed(queue) {
  return queue.bull.add('place', { id: 'demo' });
}
```

```ts good reconfigured options={"allowIn":["scripts/**"]} filename=scripts/seed.ts
import { dedupe } from '@noctcore/jobs';

export function seed(queue) {
  return queue.bull.add('place', { id: 'demo' });
}
```

## When not to use it

If an app runs `@noctcore/jobs` beside queues it still enqueues to with plain BullMQ on purpose (a
queue owned by another service, consumed by a worker that is not on the jobs runtime), list those
files in `allowIn`.

## Related

- [`add-requires-dedupe`](/eslint-plugins/rules/nestjs/add-requires-dedupe/) checks the options of `add()` on a `JobQueue`.
- [`queue-registration-through-define-queue`](/eslint-plugins/rules/nestjs/queue-registration-through-define-queue/) reports
  the hand-built BullMQ queues these raw adds usually go to.
