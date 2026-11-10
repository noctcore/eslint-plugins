import { ruleTester } from '@noctcore/eslint-test-utils';

import { queueAddRequiresDedupKeyRule } from '../../src/rules/queue-add-requires-dedup-key';

ruleTester.run('queue-add-requires-dedup-key', queueAddRequiresDedupKeyRule, {
  valid: [
    // A deterministic key: a producer retry lands on the same job.
    { code: `this.queue.add(JOB.SEND, withJobContext(data), { jobId });` },
    { code: `this.queue.add(JOB.SEND, data, { priority: 5, jobId: \`w-\${id}\` });` },
    // randomUUID() is the explicit "every call is a new job".
    { code: `this.queue.add(JOB.DISPATCH, data, { jobId: randomUUID() });` },
    // BullMQ deduplication, which outlives removeOnComplete.
    { code: `this.queue.add(JOB.SEND, data, { deduplication: { id, ttl } });` },
    // A quoted key is the same key.
    { code: `emailQueue.add(JOB.SEND, data, { 'jobId': id });` },
    // Keyed only when there is a key to use: visible, and allowed.
    { code: `this.queue.add(JOB.SEND, data, { priority: 5, ...(jobId ? { jobId } : {}) });` },
    { code: `this.queue.add(JOB.SEND, data, { ...(jobId && { jobId }) });` },
    // A bulk enqueue whose every job carries its key.
    {
      code: `this.queue.addBulk(ids.map((id) => ({ name: JOB.DISPATCH, data: { id }, opts: { jobId: randomUUID() } })));`,
    },
    { code: `emailQueue.addBulk([{ name: 'a', data: a, opts: { jobId: 'a' } }]);` },
    // Not a queue receiver.
    { code: `seen.add(value);` },
    { code: `this.repository.add(a, b);` },
    { code: `queue[method](a, b);` },
    // A receiver the custom pattern does not cover.
    { code: `this.queue.add(JOB.SEND, data);`, options: [{ queuePattern: '^jobs$' }] },
  ],
  invalid: [
    {
      code: `this.queue.add(JOB.SEND, withJobContext(data));`,
      errors: [{ messageId: 'missingKey', column: 1 }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, { priority: 5 });`,
      errors: [{ messageId: 'missingKey', column: 32 }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, jobOptions);`,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, { ...defaults });`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.addBulk(ids.map((id) => ({ name: JOB.DISPATCH, data: { id } })));`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.addBulk(ids.map((id) => ({ name: JOB.DISPATCH, data: { id }, opts: { priority: 1 } })));`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.addBulk(ids.map((id) => ({ name: JOB.DISPATCH, data: { id }, opts })));`,
      errors: [{ messageId: 'optionsNotLiteral' }],
    },
    { code: `this.queue.addBulk(jobs);`, errors: [{ messageId: 'jobsNotLiteral' }] },
    { code: `this.queue.addBulk();`, errors: [{ messageId: 'jobsNotLiteral' }] },
    // A key that is not there at runtime.
    {
      code: `this.queue.add(JOB.SEND, data, { jobId: undefined });`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, { deduplication: undefined });`,
      errors: [{ messageId: 'missingKey' }],
    },
    // A spread counts only as the visible conditional form; a key buried in a
    // call or a nested object inside it does not.
    {
      code: `this.queue.add(JOB.SEND, data, { ...buildOptions({ jobId }) });`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, { ...(ok ? { meta: { jobId } } : {}) });`,
      errors: [{ messageId: 'missingKey' }],
    },
    {
      code: `this.queue.add(JOB.SEND, data, { ...(ok ? { jobId: undefined } : {}) });`,
      errors: [{ messageId: 'missingKey' }],
    },
    // A custom receiver pattern.
    {
      code: `this.jobs.add(JOB.SEND, data);`,
      options: [{ queuePattern: '^jobs$' }],
      errors: [{ messageId: 'missingKey' }],
    },
  ],
});
