# `noctcore-nestjs/job-name-must-be-constant`

> Queue and job names come from shared constants, not inline string literals.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A queue name is a contract between the producer that enqueues and the worker that consumes, and a
job name is a contract between the producer and the worker's dispatch. Written inline on both sides,
a typo compiles, type-checks and silently routes the job nowhere: `@Processor('emails')` listens on
one queue while `@InjectQueue('email')` feeds another.

```ts bad
@Processor('email-delivery')
export class EmailProcessor extends WorkerHost {
  async process(job: Job) {}
}
```

```ts good
@Processor(QUEUE_NAMES.EMAIL_DELIVERY)
export class EmailProcessor extends WorkerHost {
  async process(job: Job) {}
}
```

## What it flags

A string literal, or a template literal with no substitutions, as:

- the first argument of a listed decorator (default `@Processor(...)` and `@InjectQueue(...)`,
  also as `@ns.Processor(...)`), the queue name;
- the first argument of `<queue>.add(...)` on a receiver matching `queuePattern`, the job name.

```ts bad
export class SignupService {
  constructor(@InjectQueue('email') private readonly emailQueue: Queue) {}

  async signUp(userId: string) {
    await this.emailQueue.add('send-welcome', { userId }, { jobId: userId });
  }
}
```

```ts good
export class SignupService {
  constructor(@InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue) {}

  async signUp(userId: string) {
    await this.emailQueue.add(JOB_NAMES.SEND_WELCOME, { userId }, { jobId: userId });
  }
}
```

There is no autofix: the rule has no map from a literal to the constant that should replace it.

## What it does not flag

- An identifier or member access (`EMAIL_QUEUE`, `QUEUE_NAMES.EMAIL`), or a template literal that
  builds the name from a constant.
- `@Processor({ name: ... })` with an options object, `new Worker('name', ...)` and
  `BullModule.registerQueue({ name })`: only the call shapes above are checked.
- `.add` on a receiver that does not look like a queue, such as `set.add('key')`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `queuePattern` | `string` (regular expression, case-insensitive) | `'queue'` | A receiver (`this.<name>` or a bare `<name>`) whose name matches counts as a BullMQ queue. |
| `decorators` | `string[]` | `['Processor', 'InjectQueue']` | Decorators whose first argument is a queue name. |

```js
'noctcore-nestjs/job-name-must-be-constant': ['error', { decorators: ['Processor'] }]
```

## When not to use it

The NestJS docs write queue names inline, and a small app with one queue and one worker in the same
folder gains little from a constants module. Turn it on once producers and workers live apart.

## Related

- [`queue-add-requires-dedup-key`](/eslint-plugins/rules/nestjs/queue-add-requires-dedup-key/)
  checks the options of the same `add` calls.
