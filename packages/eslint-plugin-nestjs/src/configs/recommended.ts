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
 *
 * `worker-must-listen-failed` is in: a worker nobody listens to is a defect in
 * any repo, and the rule needs no options.
 */
export const recommended = {
  'noctcore-nestjs/schedule-states-time-zone': 'error',
  'noctcore-nestjs/worker-must-listen-failed': 'error',
} as const;
