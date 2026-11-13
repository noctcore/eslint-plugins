import { ruleTester } from '@noctcore/eslint-test-utils';

import { workerConcurrencyRule } from '../../src/rules/worker-concurrency';

const IMPORT = `import { Worker } from 'bullmq';\n`;
const EXPLICIT = [{ requireExplicit: true }];

ruleTester.run('worker-concurrency', workerConcurrencyRule, {
  valid: [
    {
      name: 'positive integer literal',
      code: `${IMPORT}new Worker('q', run, { concurrency: 5 });`,
    },
    {
      name: 'identifier',
      code: `${IMPORT}new Worker('q', run, { concurrency: WORKERS });`,
    },
    {
      name: 'member access',
      code: `${IMPORT}new Worker('q', run, { concurrency: config.concurrency });`,
    },
    {
      name: 'call',
      code: `${IMPORT}new Worker('q', run, { concurrency: config.get('c') });`,
    },
    {
      name: 'options passed by name',
      code: `${IMPORT}new Worker('q', run, opts);`,
    },
    {
      name: 'Worker not from bullmq',
      code: `new Worker('q', run, { concurrency: 0 });`,
    },
    {
      name: 'local Worker class',
      code: `${IMPORT.replace('Worker', 'Other')}class Worker {}\nnew Worker('q', run, { concurrency: 0 });`,
    },
    {
      name: 'namespace import',
      code: `import * as bullmq from 'bullmq';\nnew bullmq.Worker('q', run, { concurrency: 0 });`,
    },
    {
      name: 'string literal',
      code: `${IMPORT}new Worker('q', run, { concurrency: '0' });`,
    },
    {
      name: 'spread argument',
      code: `${IMPORT}new Worker(...args, { concurrency: 0 });`,
    },
    {
      name: 'Processor with positive concurrency',
      code: `@Processor(QUEUE, { concurrency: 3 }) class P extends WorkerHost {}`,
    },
    {
      name: 'Processor with one argument',
      code: `@Processor(QUEUE) class P extends WorkerHost {}`,
    },
    {
      name: 'Processor object first argument',
      code: `@Processor({ name: QUEUE, concurrency: 0 }) class P extends WorkerHost {}`,
    },
    {
      name: 'Processor object first argument with requireExplicit',
      code: `@Processor({ name: QUEUE, concurrency: 4 }) class P extends WorkerHost {}`,
      options: EXPLICIT,
    },
    {
      name: 'other decorator',
      code: `class S { constructor(@InjectQueue(Q, { concurrency: 0 }) private queue: Queue) {} }`,
    },
    {
      name: 'Processor used without a call',
      code: `@Processor class P {}`,
    },
    {
      name: 'worker without options allowed by default',
      code: `${IMPORT}new Worker('q', run);`,
    },
    {
      name: 'worker options without the key allowed by default',
      code: `${IMPORT}new Worker('q', run, { connection });`,
    },
    {
      name: 'worker options undefined allowed by default',
      code: `${IMPORT}new Worker('q', run, undefined);`,
    },
    {
      name: 'Processor without worker options allowed by default',
      code: `@Processor(QUEUE) class P extends WorkerHost {}`,
    },
    {
      name: 'Processor options without the key allowed by default',
      code: `@Processor(QUEUE, { lockDuration: 30000 }) class P extends WorkerHost {}`,
    },
    {
      name: 'options holding a spread with requireExplicit',
      code: `${IMPORT}new Worker('q', run, { ...base });`,
      options: EXPLICIT,
    },
    {
      name: 'options passed by name with requireExplicit',
      code: `${IMPORT}new Worker('q', run, opts);`,
      options: EXPLICIT,
    },
    {
      name: 'explicit positive key with requireExplicit',
      code: `${IMPORT}new Worker('q', run, { concurrency: 2 });`,
      options: EXPLICIT,
    },
  ],
  invalid: [
    {
      name: 'zero concurrency on a bullmq worker',
      code: `${IMPORT}new Worker('q', run, { concurrency: 0 });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'negative zero',
      code: `${IMPORT}new Worker('q', run, { concurrency: -0 });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'negative literal',
      code: `${IMPORT}new Worker('q', run, { concurrency: -1 });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'negative fraction reports once as not positive',
      code: `${IMPORT}new Worker('q', run, { concurrency: -2.5 });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'fractional literal',
      code: `${IMPORT}new Worker('q', run, { concurrency: 2.5 });`,
      errors: [{ messageId: 'notInteger' }],
    },
    {
      name: 'renamed import',
      code: `import { Worker as BullWorker } from 'bullmq';\nnew BullWorker('q', run, { concurrency: 0 });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'options under a type assertion',
      code: `${IMPORT}new Worker('q', run, { concurrency: 0 } as WorkerOptions);`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'value under a type assertion',
      code: `${IMPORT}new Worker('q', run, { concurrency: 0 as number });`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'Processor worker options with zero',
      code: `@Processor(QUEUE, { concurrency: 0 }) class P extends WorkerHost {}`,
      errors: [{ messageId: 'notPositive' }],
    },
    {
      name: 'namespaced Processor',
      code: `@bull.Processor(QUEUE, { concurrency: 1.5 }) class P extends WorkerHost {}`,
      errors: [{ messageId: 'notInteger' }],
    },
    {
      name: 'worker without options',
      code: `${IMPORT}new Worker('q', run);`,
      options: EXPLICIT,
      errors: [{ messageId: 'missingConcurrency', type: 'NewExpression' }],
    },
    {
      name: 'worker options without the key',
      code: `${IMPORT}new Worker('q', run, { connection });`,
      options: EXPLICIT,
      errors: [{ messageId: 'missingConcurrency', type: 'ObjectExpression' }],
    },
    {
      name: 'worker options undefined',
      code: `${IMPORT}new Worker('q', run, undefined);`,
      options: EXPLICIT,
      errors: [{ messageId: 'missingConcurrency' }],
    },
    {
      name: 'Processor without worker options',
      code: `@Processor(QUEUE) class P extends WorkerHost {}`,
      options: EXPLICIT,
      errors: [{ messageId: 'missingConcurrency', type: 'Decorator' }],
    },
    {
      name: 'Processor options without the key',
      code: `@Processor(QUEUE, { lockDuration: 30000 }) class P extends WorkerHost {}`,
      options: EXPLICIT,
      errors: [{ messageId: 'missingConcurrency', type: 'ObjectExpression' }],
    },
    {
      name: 'a bad literal is still reported with requireExplicit',
      code: `${IMPORT}new Worker('q', run, { concurrency: 0 });`,
      options: EXPLICIT,
      errors: [{ messageId: 'notPositive' }],
    },
  ],
});
