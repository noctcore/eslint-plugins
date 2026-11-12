---
'@noctcore/eslint-plugin-nestjs': minor
---

Add two BullMQ worker rules, both on in `recommended` at `error`. A project spreading `recommended` will see new errors.

`worker-must-listen-failed` reports a `new Worker(...)` imported from `bullmq` (renamed imports included) that has no `.on('failed', ...)` listener in the same file, and a `new Worker(...)` written as a bare statement with nothing chained on it. A listener chained on the constructor or attached through the same binding (`worker.on(...)`, `this.worker.on(...)`, `addListener` too) anywhere in the file counts, and so does a worker that is returned, passed to a function or stored in another binding. Bindings are resolved through scope, so two workers named `worker` in different functions are checked apart. A listener whose event name is not a static string (an enum member, a loop variable) counts for every event. NestJS `@Processor` classes extending `WorkerHost` are not affected. To fix a report, add `worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }))` or chain it on the constructor. The `requiredEvents` option (default `['failed']`) can ask for more events.

`worker-must-implement-close` reports a class that creates a `bullmq` `Worker` in an instance field (a field initialiser, or `this.worker = new Worker(...)` in a method) when none of its close methods calls `this.worker.close()`, directly, through a local alias or through a helper method it calls on `this` or `super`. A close method inherited from a base class in the same file counts; a class extending a base from another module, or with an abstract close method, is not reported. The default close methods are `close`, `shutdown`, `dispose`, `onModuleDestroy`, `onApplicationShutdown` and `beforeApplicationShutdown`; `closeMethodNames` replaces the list. To fix a report, add `async onModuleDestroy() { await this.worker.close(); }`.

To keep the old behaviour, turn either rule off after spreading the preset: `'noctcore-nestjs/worker-must-listen-failed': 'off'` or `'noctcore-nestjs/worker-must-implement-close': 'off'`.
