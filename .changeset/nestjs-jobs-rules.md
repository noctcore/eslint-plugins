---
'@noctcore/eslint-plugin-nestjs': minor
---

Six new rules for apps on `@noctcore/jobs`, all on in `recommended`:

- `worker-extends-job-host`: a `@Worker(queue)` class from `@noctcore/jobs` must extend `JobHost` (directly or through a base class in the same file); in an app that uses the package, a NestJS `@Processor` / `WorkerHost` worker is reported too.
- `no-dynamic-job-name`: the job name of `add()` on a jobs queue and the name of a `@Sweep()` must not be built at run time (template with substitutions, concatenation, call, `process.env` read).
- `add-requires-dedupe`: every `add()` on a jobs queue passes `{ dedupe: ... }`; a raw `jobId` or `deduplication` in its options is reported.
- `no-raw-bullmq-queue-add`: `.add()` / `.addBulk()` on a BullMQ queue (`queue.bull`, `new Queue(...)`, `@InjectQueue` from `@nestjs/bullmq`, a `Queue` annotation) is reported.
- `queue-registration-through-define-queue`: `new Queue` / `new Worker` / `new QueueEvents` from `bullmq` and `BullModule.registerQueue(Async)` are reported; queues come from `defineQueue` and `JobsModule.forFeature`.
- `no-direct-rate-limit`: BullMQ `rateLimit()` on a queue or worker, `Worker.RateLimitError()` and `new RateLimitError()` are reported; pause with `pauseQueue` / `pauseFor`.

Each rule checks for the package itself. `worker-extends-job-host` (for `@Worker`), `no-dynamic-job-name` and `add-requires-dedupe` only read files that import `@noctcore/jobs`; the other three, and the `@Processor` half of `worker-extends-job-host`, also read files of a project whose `package.json` (from the file's directory up to the workspace root) declares it. A project that spreads `recommended` and does not use `@noctcore/jobs` sees no new errors. A project that does use it will see errors wherever BullMQ is used beside it by hand, which is what the rules are for; `allowIn` on the three BullMQ rules exempts files such as seed scripts and tests.
