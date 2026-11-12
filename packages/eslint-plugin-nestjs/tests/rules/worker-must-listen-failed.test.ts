import { ruleTester } from '@noctcore/eslint-test-utils';

import { workerMustListenFailedRule } from '../../src/rules/worker-must-listen-failed';

const IMPORT = `import { Worker } from 'bullmq';\n`;

ruleTester.run('worker-must-listen-failed', workerMustListenFailedRule, {
  valid: [
    {
      name: 'listener on the const',
      code: `${IMPORT}const w = new Worker('mail', run, { connection });
w.on('failed', (job, err) => log.error({ jobId: job?.id, err }));`,
    },
    {
      name: 'listener in another method',
      code: `${IMPORT}class S {
  private worker = new Worker('m', run);
  onModuleInit() { this.worker.on('failed', f); }
}`,
    },
    {
      name: 'listener on a this binding assigned in a method',
      code: `${IMPORT}class S {
  worker;
  init() {
    this.worker = new Worker('m', run);
    this.worker.on('failed', f);
  }
}`,
    },
    {
      name: 'listener written before the worker',
      code: `${IMPORT}function attach() { w.on('failed', f); }
const w = new Worker('m', run);`,
    },
    {
      name: 'chained listener on a bare statement',
      code: `${IMPORT}new Worker('m', run).on('failed', f);`,
    },
    {
      name: 'chained listener on a const',
      code: `${IMPORT}const w = new Worker('m', run).on('failed', f);`,
    },
    {
      name: 'chained listener after another event',
      code: `${IMPORT}const w = new Worker('m', run).on('completed', done).on('failed', f);`,
    },
    {
      name: 'listener chained after another listener on the binding',
      code: `${IMPORT}const w = new Worker('m', run);
w.on('completed', done).on('failed', f);`,
    },
    {
      name: 'template literal event',
      code: `${IMPORT}const w = new Worker('m', run);
w.on(\`failed\`, f);`,
    },
    {
      name: 'returned from a function',
      code: `${IMPORT}function make() { return new Worker('m', run); }`,
    },
    {
      name: 'returned from an arrow',
      code: `${IMPORT}const make = () => new Worker('m', run);`,
    },
    {
      name: 'binding returned',
      code: `${IMPORT}function make() { const w = new Worker('m', run); return w; }`,
    },
    {
      name: 'passed as an argument',
      code: `${IMPORT}register(new Worker('m', run));`,
    },
    {
      name: 'binding passed as an argument',
      code: `${IMPORT}const w = new Worker('m', run);
track(w);`,
    },
    {
      name: 'this binding passed as an argument',
      code: `${IMPORT}class S {
  private worker = new Worker('m', run);
  onModuleInit() { this.registry.add(this.worker); }
}`,
    },
    {
      name: 'binding stored in an object',
      code: `${IMPORT}const w = new Worker('m', run);
export const workers = { mail: w };`,
    },
    {
      name: 'WorkerHost processor',
      code: `import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
@Processor(QUEUE)
class P extends WorkerHost {
  async process() {}
  @OnWorkerEvent('failed')
  onFailed() {}
}`,
    },
    {
      name: 'Worker not from bullmq is ignored',
      code: `import { Worker } from 'node:worker_threads';
const w = new Worker(file);`,
    },
    {
      name: 'local class named Worker is ignored',
      code: `class Worker {}
const w = new Worker();`,
    },
    {
      name: 'shadowed import is ignored',
      code: `${IMPORT}function spawn(Worker) { const w = new Worker(file); }`,
    },
    {
      name: 'other bullmq classes are not workers',
      code: `import { Queue, QueueEvents } from 'bullmq';
const q = new Queue('mail');
const e = new QueueEvents('mail');`,
    },
    {
      name: 'type-only import is ignored',
      code: `import type { Worker } from 'bullmq';
const w = new Worker('m', run);`,
    },
    {
      name: 'requiredEvents all heard',
      code: `${IMPORT}const w = new Worker('m', run);
w.on('failed', f);
w.on('error', g);`,
      options: [{ requiredEvents: ['failed', 'error'] }],
    },
  ],
  invalid: [
    {
      name: 'const binding with no failed listener',
      code: `${IMPORT}const w = new Worker('mail', run, { connection });`,
      errors: [{ messageId: 'missingListener', line: 2, column: 11, data: { name: 'w', events: "'failed'" } }],
    },
    {
      name: 'this binding with no failed listener',
      code: `${IMPORT}class S {
  worker;
  init() { this.worker = new Worker('mail', run); }
}`,
      errors: [{ messageId: 'missingListener', data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'field initialiser with no failed listener',
      code: `${IMPORT}class S { private worker = new Worker('mail', run); }`,
      errors: [{ messageId: 'missingListener', data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'listener for another event only',
      code: `${IMPORT}const w = new Worker('m', run);
w.on('completed', done);`,
      errors: [{ messageId: 'missingListener' }],
    },
    {
      name: 'listener on another binding',
      code: `${IMPORT}const w = new Worker('m', run);
other.on('failed', f);`,
      errors: [{ messageId: 'missingListener' }],
    },
    {
      name: 'bare expression statement',
      code: `${IMPORT}new Worker('mail', run);`,
      errors: [{ messageId: 'unboundWorker', line: 2, column: 1 }],
    },
    {
      name: 'bare statement with a chained listener for another event',
      code: `${IMPORT}new Worker('mail', run).on('completed', done);`,
      errors: [{ messageId: 'unboundWorker' }],
    },
    {
      name: 'requiredEvents option',
      code: `${IMPORT}const w = new Worker('m', run);
w.on('failed', f);`,
      options: [{ requiredEvents: ['failed', 'error'] }],
      errors: [{ messageId: 'missingListener', data: { name: 'w', events: "'error'" } }],
    },
    {
      name: 'renamed import is resolved',
      code: `import { Worker as BullWorker } from 'bullmq';
const w = new BullWorker('mail', run);`,
      errors: [{ messageId: 'missingListener' }],
    },
    {
      name: 'type assertion on the worker',
      code: `${IMPORT}const w = new Worker('mail', run) as Worker;`,
      errors: [{ messageId: 'missingListener' }],
    },
    {
      name: 'one report per worker',
      code: `${IMPORT}const a = new Worker('a', run);
const b = new Worker('b', run);
a.on('failed', f);`,
      errors: [{ messageId: 'missingListener', line: 3, data: { name: 'b', events: "'failed'" } }],
    },
  ],
});
