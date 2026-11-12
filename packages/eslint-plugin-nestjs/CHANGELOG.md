# @noctcore/eslint-plugin-nestjs

## 0.2.0

### Minor Changes

- [#234](https://github.com/noctcore/eslint-plugins/pull/234) [`c7d704d`](https://github.com/noctcore/eslint-plugins/commit/c7d704d4fa39b24b500b5dff4b3af857ba288482) Thanks [@Shironex](https://github.com/Shironex)! - Add two BullMQ worker rules, both on in `recommended` at `error`. A project spreading `recommended` will see new errors.
  
  `worker-must-listen-failed` reports a `new Worker(...)` imported from `bullmq` (renamed imports included) that has no `.on('failed', ...)` listener in the same file, and a `new Worker(...)` written as a bare statement with nothing chained on it. A listener chained on the constructor or attached through the same binding (`worker.on(...)`, `this.worker.on(...)`, `addListener` and `prependListener` too) anywhere in the file counts, and so does a worker that is returned, passed to a function or stored in another binding. Bindings are resolved through scope, so two workers named `worker` in different functions are checked apart, while `this.worker` is shared with a base class or subclass declared in the same file, so a base service that wires the listeners covers its subclass's worker. A worker held in a field of a class whose base comes from another module is not reported, since that base may listen. A listener whose event name is not a static string (an enum member, a loop variable) counts for every event. NestJS `@Processor` classes extending `WorkerHost` are not affected. To fix a report, add `worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }))` or chain it on the constructor. The `requiredEvents` option (default `['failed']`) can ask for more events.
  
  `worker-must-implement-close` reports a class that creates a `bullmq` `Worker` in an instance field (a field initialiser, or `this.worker = new Worker(...)` in a method) when none of its close methods calls `this.worker.close()`, directly, through a local alias (`const self = this` included) or through a helper method it calls on `this` or `super`. A worker the close method passes to a function (`closeQuietly(this.worker)`) or puts in an array literal counts as closed there. A close method inherited from a base class in the same file counts; a class extending a base from another module or a `declare class`, or with an abstract close method, is not reported. The default close methods are `close`, `shutdown`, `dispose`, `onModuleDestroy`, `onApplicationShutdown` and `beforeApplicationShutdown`; `closeMethodNames` replaces the list. To fix a report, add `async onModuleDestroy() { await this.worker.close(); }`.
  
  To keep the old behaviour, turn either rule off after spreading the preset: `'noctcore-nestjs/worker-must-listen-failed': 'off'` or `'noctcore-nestjs/worker-must-implement-close': 'off'`.

## 0.1.0

### Minor Changes

- [#160](https://github.com/noctcore/eslint-plugins/pull/160) [`f9378ce`](https://github.com/noctcore/eslint-plugins/commit/f9378ce59135d6dabcf8844ec98b8da7b31431ea) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-nestjs` for NestJS and BullMQ background work, starting at 0.1.0 with three rules:
  
  - `schedule-states-time-zone` (in `recommended` at `error`): a `@Cron` states `timeZone` (or `utcOffset`), and a BullMQ `upsertJobScheduler` or `repeat: { pattern }` states `tz`. The `zones` option restricts which zones may be stated.
  - `queue-add-requires-dedup-key` (opt-in): every `<queue>.add` / `.addBulk` job carries a `jobId` or `deduplication` in literal options.
  - `job-name-must-be-constant` (opt-in): queue and job names in `@Processor`, `@InjectQueue` and `<queue>.add` are shared constants, not inline strings.

### Patch Changes

- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0
