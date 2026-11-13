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
 */
export const recommended = {
  'noctcore-nestjs/schedule-states-time-zone': 'error',
  'noctcore-nestjs/worker-must-implement-close': 'error',
  'noctcore-nestjs/worker-must-listen-failed': 'error',
} as const;
