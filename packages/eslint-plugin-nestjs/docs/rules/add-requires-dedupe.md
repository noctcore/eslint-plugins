# `noctcore-nestjs/add-requires-dedupe`

> Every `add()` on a `@noctcore/jobs` queue passes an explicit `dedupe` choice, and never a raw `jobId` or `deduplication`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`@noctcore/jobs` makes dedupe a choice every enqueue states: `dedupe.window(key, ttl)`,
`dedupe.until(key)`, `dedupe.debounce(key, wait)`, or `dedupe.none()` for "every call is a new job".
The types require it on a typed queue. JavaScript callers and queues typed as `any` get no such
help, and the mistakes are quiet: with no `dedupe` the call throws when it builds the job, and a
`jobId` passed the way plain BullMQ takes it is dropped, so a caller who meant to dedupe gets a new
job on every retry. A caller-built `jobId` was the trap in the first place: it only dedupes while
the first job is still kept, and a colon in it makes BullMQ refuse the job.

```ts bad
import { dedupe } from '@noctcore/jobs';

export function placeOrder(queue, id: string, data) {
  return queue.add('place', data, { jobId: `order:${id}` });
}
```

```ts good
import { dedupe } from '@noctcore/jobs';

export function placeOrder(queue, id: string, data) {
  return queue.add('place', data, { dedupe: dedupe.window(['order', id], '1h') });
}
```

## What it flags

On `add(name, data, options)` on a `@noctcore/jobs` queue, in a file that imports
`@noctcore/jobs`:

- no options at all;
- an options object literal with no `dedupe` (or `dedupe: undefined`) and no spread;
- a `jobId` or `deduplication` key in the options, which a `JobQueue` never passes on.

A queue is recognised the way the other `@noctcore/jobs` rules recognise it: a receiver the file
declares as a `JobQueue` (an `@InjectQueue(queue)` parameter from `@noctcore/jobs`, or a `JobQueue`
annotation), or, when the file says nothing about it, a receiver whose name matches `queuePattern`.

```ts bad reports=2
import { InjectQueue, JobQueue } from '@noctcore/jobs';

import { mail } from './queues';

export class MailService {
  constructor(@InjectQueue(mail) private readonly mail: JobQueue<typeof mail>) {}

  verify(userId: string) {
    return this.mail.add('verify', { userId });
  }

  digest(day: string) {
    return this.mail.add('digest', { day }, { delay: '5m' });
  }
}
```

```ts good
import { InjectQueue, JobQueue, dedupe } from '@noctcore/jobs';

import { mail } from './queues';

export class MailService {
  constructor(@InjectQueue(mail) private readonly mail: JobQueue<typeof mail>) {}

  verify(userId: string) {
    return this.mail.add('verify', { userId }, { dedupe: dedupe.until(['verify', userId]) });
  }

  digest(day: string) {
    return this.mail.add('digest', { day }, { dedupe: dedupe.none(), delay: '5m' });
  }
}
```

## What it does not flag

- Options passed by name, or an options literal with a spread that may carry `dedupe`: the rule
  only reads what it can see, and the types check the rest.
- A `dedupe` value held in a variable.
- `add()` on a BullMQ queue (`queue.bull.add(...)`, `new Queue(...)` from `bullmq`, a receiver
  annotated `Queue` from `bullmq`): [`no-raw-bullmq-queue-add`](/eslint-plugins/rules/nestjs/no-raw-bullmq-queue-add/)
  reports those.
- A file that does not import `@noctcore/jobs`, and an `add` with fewer than two arguments.

```ts good
import { dedupe } from '@noctcore/jobs';

const once = dedupe.until('nightly-export');

export function enqueue(queue, options) {
  queue.add('export', {}, { dedupe: once });
  return queue.add('export', {}, options);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` | `'queue'` | Case-insensitive regular expression a receiver name must match to count as a queue when the file does not declare it as a `JobQueue`. |

```js
'noctcore-nestjs/add-requires-dedupe': ['error', { queuePattern: 'queue|outbox' }]
```

```ts bad options={"queuePattern":"queue|outbox"}
import { dedupe } from '@noctcore/jobs';

export function relay(outbox, data) {
  return outbox.add('relay', data);
}
```

```ts good options={"queuePattern":"queue|outbox"}
import { dedupe } from '@noctcore/jobs';

export function relay(outbox, data) {
  return outbox.add('relay', data, { dedupe: dedupe.none() });
}
```

## When not to use it

If every caller is TypeScript with typed queues, the compiler already refuses a missing `dedupe`;
the rule still catches a raw `jobId` next to it and queues typed as `any`, so it is cheap to keep.
Turn it off for a file whose `queue` receivers are not `@noctcore/jobs` queues and are not declared
as anything the rule can read.

## Related

- [`queue-add-requires-dedup-key`](/eslint-plugins/rules/nestjs/queue-add-requires-dedup-key/) is the plain BullMQ
  counterpart and asks for the `jobId` this rule reports. Do not turn both on for the same files.
