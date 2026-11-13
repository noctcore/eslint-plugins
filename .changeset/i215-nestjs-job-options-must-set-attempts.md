---
'@noctcore/eslint-plugin-nestjs': minor
---

Add `job-options-must-set-attempts`, an opt-in rule that reports a BullMQ `<queue>.add(name, data, options)` or `<queue>.addBulk([...])` job whose options and queue defaults set no `attempts`, so a single transient failure would lose the job. The call's options are laid over the `defaultJobOptions` of a `new Queue(...)` imported from `bullmq` and stored in the same binding in the same file; defaults set anywhere else are not seen. With `requireBackoff` (default `true`), a literal `attempts` other than `1` must also come with a `backoff`. Options or `addBulk` jobs that are not object literals, a spread that may hold the missing key, a non-literal `attempts` and any `FlowProducer` call are skipped; `queuePattern` picks which receivers count as queues, as in the other queue rules. The rule is not in `recommended`, so a project spreading it sees no new errors.

The shared `this` resolver no longer throws on a `this` at the top level of a file, which crashed `worker-must-listen-failed` on code such as `this.worker.on('failed', handler)` outside a class.
