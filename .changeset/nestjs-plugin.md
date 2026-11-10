---
'@noctcore/eslint-plugin-nestjs': minor
---

New package `@noctcore/eslint-plugin-nestjs` for NestJS and BullMQ background work, starting at 0.1.0 with three rules:

- `schedule-states-time-zone` (in `recommended` at `error`): a `@Cron` states `timeZone` (or `utcOffset`), and a BullMQ `upsertJobScheduler` or `repeat: { pattern }` states `tz`. The `zones` option restricts which zones may be stated.
- `queue-add-requires-dedup-key` (opt-in): every `<queue>.add` / `.addBulk` job carries a `jobId` or `deduplication` in literal options.
- `job-name-must-be-constant` (opt-in): queue and job names in `@Processor`, `@InjectQueue` and `<queue>.add` are shared constants, not inline strings.
