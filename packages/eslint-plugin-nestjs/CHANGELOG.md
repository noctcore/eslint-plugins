# @noctcore/eslint-plugin-nestjs

## 0.1.0

### Minor Changes

- [#160](https://github.com/noctcore/eslint-plugins/pull/160) [`f9378ce`](https://github.com/noctcore/eslint-plugins/commit/f9378ce59135d6dabcf8844ec98b8da7b31431ea) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-nestjs` for NestJS and BullMQ background work, starting at 0.1.0 with three rules:
  
  - `schedule-states-time-zone` (in `recommended` at `error`): a `@Cron` states `timeZone` (or `utcOffset`), and a BullMQ `upsertJobScheduler` or `repeat: { pattern }` states `tz`. The `zones` option restricts which zones may be stated.
  - `queue-add-requires-dedup-key` (opt-in): every `<queue>.add` / `.addBulk` job carries a `jobId` or `deduplication` in literal options.
  - `job-name-must-be-constant` (opt-in): queue and job names in `@Processor`, `@InjectQueue` and `<queue>.add` are shared constants, not inline strings.

### Patch Changes

- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0
