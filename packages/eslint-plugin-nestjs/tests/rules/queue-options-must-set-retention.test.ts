import { ruleTester } from '@noctcore/eslint-test-utils';

import { queueOptionsMustSetRetentionRule } from '../../src/rules/queue-options-must-set-retention';

const IMPORT = `import { Queue } from 'bullmq';\n`;
const BOTH = `{ removeOnComplete: true, removeOnFail: true }`;
const INJECTED = (body: string): string =>
  `class P {\n  constructor(private queue: Queue) {}\n  send() { ${body} }\n}`;
const BOTH_KEYS = '`removeOnComplete` and `removeOnFail`';

ruleTester.run('queue-options-must-set-retention', queueOptionsMustSetRetentionRule, {
  valid: [
    {
      name: 'both keys per call',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: true, removeOnFail: 1000 });`),
    },
    {
      name: 'both keys in defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
    },
    {
      name: 'split between the call and the defaults',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { removeOnComplete: true } });\nqueue.add('x', d, { removeOnFail: true });`,
    },
    {
      name: 'defaults on a class field',
      code: `${IMPORT}class P {\n  private queue = new Queue('m', { defaultJobOptions: ${BOTH} });\n  send() { this.queue.add('x', d); }\n}`,
    },
    {
      name: 'defaults assigned in the constructor',
      code: `${IMPORT}class P {\n  private queue: Queue;\n  constructor() { this.queue = new Queue('m', { defaultJobOptions: ${BOTH} }); }\n  send() { this.queue.add('x', d); }\n}`,
    },
    {
      name: 'defaults from a base class in the file',
      code: `${IMPORT}class Base {\n  protected queue: Queue;\n  constructor() { this.queue = new Queue('m', { defaultJobOptions: ${BOTH} }); }\n}\nclass P extends Base {\n  send() { this.queue.add('x', d); }\n}`,
    },
    {
      name: 'declaration after the add',
      code: `${IMPORT}function send() { queue.add('x', d); }\nconst queue = new Queue('m', { defaultJobOptions: ${BOTH} });`,
    },
    {
      name: 'literal false is a choice',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: false, removeOnFail: false });`),
    },
    {
      name: 'false in defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });\nqueue.add('x', d);`,
    },
    {
      name: 'options by name are skipped',
      code: INJECTED(`this.queue.add('x', d, opts);`),
    },
    {
      name: 'spread in options is skipped',
      code: INJECTED(`this.queue.add('x', d, { ...base, attempts: 3 });`),
    },
    {
      name: 'non-literal defaultJobOptions skips the queue',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: shared });\nqueue.add('x', d);`,
    },
    {
      name: 'spread in defaultJobOptions is skipped',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { ...shared } });\nqueue.add('x', d);`,
    },
    {
      name: 'non-literal queue options are skipped',
      code: `${IMPORT}const queue = new Queue('m', opts);\nqueue.add('x', d);`,
    },
    {
      name: 'addBulk is not checked',
      code: INJECTED(`this.queue.addBulk([{ name: 'x', data: d }]);`),
    },
    {
      name: 'receiver outside the default pattern',
      code: `class P {\n  constructor(private jobs: Queue) {}\n  send() { this.jobs.add('x', d); }\n}`,
    },
    {
      name: 'a set is not a queue',
      code: `const seen = new Set();\nseen.add(v);`,
    },
    {
      name: 'receiver outside a custom pattern',
      code: INJECTED(`this.queue.add('x', d);`),
      options: [{ queuePattern: '^jobs$' }],
    },
    {
      name: 'renamed bullmq import',
      code: `import { Queue as BullQueue } from 'bullmq';\nconst queue = new BullQueue('m', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
    },
    {
      name: 'flow object first argument is skipped',
      code: INJECTED(`this.queue.add({ name: 'x', queueName: 'q', data: d });`),
    },
    {
      name: 'a single argument is skipped',
      code: INJECTED(`this.queue.add('x');`),
    },
    {
      name: 'options with a type wrapper',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: true, removeOnFail: true } as JobsOptions);`),
    },
    {
      name: 'require removeOnFail satisfied',
      code: INJECTED(`this.queue.add('x', d, { removeOnFail: true });`),
      options: [{ require: ['removeOnFail'] }],
    },
    {
      name: 'a binding two queues are stored in is skipped',
      code: `${IMPORT}let queue = new Queue('a');\nqueue = new Queue('b', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
    },
  ],
  invalid: [
    {
      name: 'no options',
      code: INJECTED(`this.queue.add('x', d);`),
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS }, line: 3, column: 12 }],
    },
    {
      name: 'undefined options',
      code: INJECTED(`this.queue.add('x', d, undefined);`),
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'options without retention',
      code: INJECTED(`this.queue.add('x', d, { attempts: 3 });`),
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS }, line: 3, column: 35 }],
    },
    {
      name: 'one key missing',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: true });`),
      errors: [{ messageId: 'missingRetention', data: { keys: '`removeOnFail`' } }],
    },
    {
      name: 'defaults on another queue do not count',
      code: `${IMPORT}const other = new Queue('o', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'queue with no defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { connection });\nqueue.add('x', d);`,
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'undefined counts as missing',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: undefined, removeOnFail: true });`),
      errors: [{ messageId: 'missingRetention', data: { keys: '`removeOnComplete`' } }],
    },
    {
      name: 'undefined in defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { removeOnComplete: undefined, removeOnFail: true } });\nqueue.add('x', d);`,
      errors: [{ messageId: 'missingRetention', data: { keys: '`removeOnComplete`' } }],
    },
    {
      name: 'a Queue not from bullmq is no declaration',
      code: `import { Queue } from './my-queue';\nconst queue = new Queue('m', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'a type-only Queue import is no declaration',
      code: `import type { Queue } from 'bullmq';\nconst queue = new Queue('m', { defaultJobOptions: ${BOTH} });\nqueue.add('x', d);`,
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'a custom pattern picks the receiver',
      code: `class P {\n  constructor(private jobs: Queue) {}\n  send() { this.jobs.add('x', d); }\n}`,
      options: [{ queuePattern: '^jobs$' }],
      errors: [{ messageId: 'missingRetention', data: { keys: BOTH_KEYS } }],
    },
    {
      name: 'require narrows to removeOnFail',
      code: INJECTED(`this.queue.add('x', d, { removeOnComplete: true });`),
      options: [{ require: ['removeOnFail'] }],
      errors: [{ messageId: 'missingRetention', data: { keys: '`removeOnFail`' } }],
    },
  ],
});
