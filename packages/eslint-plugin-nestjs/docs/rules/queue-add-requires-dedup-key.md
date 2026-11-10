# `noctcore-nestjs/queue-add-requires-dedup-key`

> Every BullMQ job a producer enqueues carries a `jobId` or `deduplication`, visible in literal options.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A producer runs more than once more often than it looks: a double submit, a replayed request, a
retried HTTP handler, a sweep that runs again after a crash. Each run calls `queue.add(...)`, and
without a key BullMQ makes a new job every time, so the email goes out twice and the invoice is
charged twice:

```ts bad
export class InvoiceService {
  constructor(private readonly invoiceQueue: Queue) {}

  async finalize(invoiceId: string) {
    await this.invoiceQueue.add(JOBS.CHARGE, { invoiceId });
  }
}
```

With a deterministic `jobId`, the second `add` lands on the job the first one made:

```ts good
export class InvoiceService {
  constructor(private readonly invoiceQueue: Queue) {}

  async finalize(invoiceId: string) {
    await this.invoiceQueue.add(JOBS.CHARGE, { invoiceId }, { jobId: `charge:${invoiceId}` });
  }
}
```

When every call really is new work, say so with `jobId: randomUUID()`: the choice is then written
down where the job is made, not left to a default.

## What it flags

A call on a receiver whose name matches `queuePattern` (default: contains `queue`, so
`this.queue`, `emailQueue`, `this.billingQueue`):

- `<queue>.add(name, data)` with no options, or options with neither `jobId` nor `deduplication`;
- a key whose value is `undefined`, nested deeper than the options object, or hidden inside a
  call's spread;
- options passed by name instead of as an object literal (reported as "write the options here");
- `<queue>.addBulk(jobs)` where a job object (an object literal with `data`) has no `opts`, or
  `opts` without a key, and `addBulk` with no job object literals at all.

```ts bad
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 3 });
await this.mailQueue.add(JOBS.WELCOME, { userId }, jobOptions);
await this.mailQueue.addBulk(users.map((user) => ({ name: JOBS.WELCOME, data: { id: user.id } })));
```

## What it does not flag

- A key in a conditional spread, the visible "key it when there is something to key it on" form:
  `{ ...(jobId ? { jobId } : {}) }` or `{ ...(jobId && { jobId }) }`.
- Calls on receivers that do not look like a queue: `set.add(value)`, `this.repository.add(...)`.
- A queue reached through a name that does not match the pattern: the check is by name, with no
  type information. Widen `queuePattern` if your queues are named otherwise.

```ts good
await this.mailQueue.add(JOBS.WELCOME, { userId }, { attempts: 3, jobId: `welcome:${userId}` });
await this.mailQueue.add(JOBS.DIGEST, { userId }, { deduplication: { id: `digest:${userId}`, ttl: 60_000 } });
await this.mailQueue.addBulk(
  users.map((user) => ({ name: JOBS.WELCOME, data: { id: user.id }, opts: { jobId: `welcome:${user.id}` } })),
);
seen.add(userId);
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` (regular expression, case-insensitive) | `'queue'` | A receiver (`this.<name>` or a bare `<name>`) whose name matches counts as a BullMQ queue. |

```js
'noctcore-nestjs/queue-add-requires-dedup-key': ['error', { queuePattern: '(queue|jobs)$' }]
```

## When not to use it

If your workers are idempotent by design, so a duplicate job costs only time, the key buys little.
It is also a poor fit when queues are passed around under names that do not say "queue" and you do
not want to tune `queuePattern`.

## Related

- [`job-name-must-be-constant`](/eslint-plugins/rules/nestjs/job-name-must-be-constant/) polices
  the first argument of the same `add` calls.
