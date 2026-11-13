# `noctcore-nestjs/worker-concurrency`

> A literal BullMQ worker `concurrency`, on `new Worker(...)` or `@Processor(queue, options)`, is a positive integer.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A BullMQ worker runs one job at a time unless `concurrency` says otherwise. The option is a count of
jobs to run in parallel, so a literal `0`, a negative number or a fraction is a configuration
defect, not a tuning choice. It is usually a typo or a half-finished edit that nobody notices until
the queue backs up:

```ts bad
import { Worker } from 'bullmq';

export const mailWorker = new Worker('mail', sendMail, { connection, concurrency: 0 });
```

```ts bad
import { Worker } from 'bullmq';

export const mailWorker = new Worker('mail', sendMail, { connection, concurrency: 2.5 });
```

State a whole number of at least 1:

```ts good
import { Worker } from 'bullmq';

export const mailWorker = new Worker('mail', sendMail, { connection, concurrency: 5 });
```

## What it flags

A `concurrency` that is a number literal of 0 or below (`0`, `-0`, `-1`) or not a whole number
(`2.5`), in the options of:

- a `new Worker(name, processor, options)` where `Worker` is imported from `bullmq`, under its own
  name or a renamed one;
- the second argument of `@Processor(queue, options)` or `@ns.Processor(queue, options)`.

A value that is 0 or below and also fractional (`-2.5`) is reported once, as not positive.

```ts bad
@Processor(QUEUE, { concurrency: -1 })
export class MailProcessor extends WorkerHost {}
```

```ts good
@Processor(QUEUE, { concurrency: 4 })
export class MailProcessor extends WorkerHost {}
```

## What it does not flag

- A `concurrency` the rule cannot read as a literal: an identifier (`concurrency: WORKERS`), a member
  access, a call (`config.get('concurrency')`), and a string literal (`'5'`).
- Options passed by name instead of an object literal, and a spread in the options or in the
  arguments: the key may come from there.
- A `Worker` that is not imported from `bullmq`, including a local class of that name.
- `new bullmq.Worker(...)` through a namespace import and `require('bullmq')`: only a named import
  is resolved.
- The `worker.concurrency = n` setter after construction.
- The first argument of `@Processor({ name, ... })`: in that form it holds the processor options and
  the worker options are the second argument, so only the second is read.

```ts good
import { Worker } from 'bullmq';
import * as bullmq from 'bullmq';

new Worker('mail', sendMail, { concurrency: WORKERS });
new Worker('mail', sendMail, { concurrency: config.get('concurrency') });
new Worker('mail', sendMail, workerOptions);
new Worker('mail', sendMail, { ...base, ...override });
new bullmq.Worker('mail', sendMail, { concurrency: 0 });
```

```ts good
@Processor({ name: QUEUE, concurrency: 0 })
export class MailProcessor extends WorkerHost {}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requireExplicit` | `boolean` | `false` | Also report a worker whose options object literal has no `concurrency` key, or that has no options at all. |

```js
'noctcore-nestjs/worker-concurrency': ['error', { requireExplicit: true }]
```

With `requireExplicit`, every worker states how many jobs it runs at once. Options passed by name
and an options literal holding a spread are still accepted, since the key may come from there:

```ts bad options={"requireExplicit":true}
import { Worker } from 'bullmq';

new Worker('mail', sendMail, { connection });
```

```ts good options={"requireExplicit":true}
import { Worker } from 'bullmq';

new Worker('mail', sendMail, { connection, concurrency: 1 });
new Worker('mail', sendMail, { ...baseOptions });
```

## When not to use it

When worker settings come from shared configuration the rule cannot read, such as a factory that
builds every options object: the rule then has nothing literal to check, and `requireExplicit`
would ask for a key that the factory already sets. The default check costs nothing in that case.

## Related

- [`worker-must-listen-failed`](/eslint-plugins/rules/nestjs/worker-must-listen-failed/) and
  [`worker-must-implement-close`](/eslint-plugins/rules/nestjs/worker-must-implement-close/) police
  the same `new Worker(...)` for a failure listener and a shutdown.
