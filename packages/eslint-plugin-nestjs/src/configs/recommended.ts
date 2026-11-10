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
 */
export const recommended = {
  'noctcore-nestjs/schedule-states-time-zone': 'error',
} as const;
