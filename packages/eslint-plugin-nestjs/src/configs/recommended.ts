/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * Left out on purpose, and listed in `tests/configs/recommended.test.ts`:
 * - `queue-add-requires-dedup-key`: it asks every enqueue to choose a key,
 *   `randomUUID()` included, which is a team convention before it is a defect.
 *   A stranger's repo would see every `queue.add` reported on day one.
 * - `job-name-must-be-constant`: inline queue names are the documented NestJS
 *   style; moving them to constants is a convention to opt into.
 * - `job-options-must-set-attempts`: how many attempts and what backoff a job
 *   gets is a decision per queue, and defaults set outside the file
 *   (`BullModule.registerQueue`, a shared config) are invisible to it, so a
 *   stranger's repo would see reports on queues that already retry.
 * - `queue-options-must-set-retention`: how long finished jobs stay is a
 *   decision per queue, and defaults set outside the file
 *   (`BullModule.registerQueue`, a shared config) are invisible to it, so a
 *   stranger's repo would see reports on queues that already clean up.
 * - `redis-client-from-factory`: it needs `factoryFunctions`, the name of the
 *   project's Redis options factory, which is a per-project fact, so it does
 *   nothing until configured and a preset cannot supply it.
 * - `worker-concurrency`: a literal `concurrency` that is 0, negative or
 *   fractional is rare, and `requireExplicit` (asking every worker to state
 *   it) is a team convention, so it is left for a repo to opt into.
 *
 * The `worker-must-*` rules are in: a worker nobody listens to or nobody closes is a
 * defect in any repo, and they need no options.
 *
 * The six `@noctcore/jobs` rules are in, because each one checks itself for the
 * package and is silent in a repo that does not use it. `worker-extends-job-host`
 * (for `@Worker`), `add-requires-dedupe` and `no-dynamic-job-name` only read
 * code that imports `@noctcore/jobs`; `no-raw-bullmq-queue-add`,
 * `queue-registration-through-define-queue`, `no-direct-rate-limit` and the
 * `@Processor` half of `worker-extends-job-host` also run in files of a project
 * whose `package.json` declares it, since a hand-built BullMQ queue has no
 * reason to import it. In such a project each of them reports a defect.
 */
export const recommended = {
  'noctcore-nestjs/add-requires-dedupe': 'error',
  'noctcore-nestjs/no-direct-rate-limit': 'error',
  'noctcore-nestjs/no-dynamic-job-name': 'error',
  'noctcore-nestjs/no-raw-bullmq-queue-add': 'error',
  'noctcore-nestjs/queue-registration-through-define-queue': 'error',
  'noctcore-nestjs/schedule-states-time-zone': 'error',
  'noctcore-nestjs/worker-extends-job-host': 'error',
  'noctcore-nestjs/worker-must-implement-close': 'error',
  'noctcore-nestjs/worker-must-listen-failed': 'error',
} as const;
