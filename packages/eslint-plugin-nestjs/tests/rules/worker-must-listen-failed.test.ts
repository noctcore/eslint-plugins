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
      name: 'binding returned from an arrow body',
      code: `${IMPORT}const w = new Worker('m', run);
export const getWorker = () => w;`,
    },
    {
      name: 'event name held in a const',
      code: `${IMPORT}const FAILED = 'failed';
const w = new Worker('m', run);
w.on(FAILED, f);`,
    },
    {
      name: 'event name with as const',
      code: `${IMPORT}const w = new Worker('m', run);
w.on('failed' as const, f);`,
    },
    {
      name: 'event name from a loop counts for every event',
      code: `${IMPORT}const w = new Worker('m', run);
for (const event of events) w.on(event, f);`,
      options: [{ requiredEvents: ['failed', 'error'] }],
    },
    {
      name: 'event name from an imported enum counts',
      code: `${IMPORT}import { Events } from './events';
const w = new Worker('m', run);
w.on(Events.Failed, f);`,
    },
    {
      name: 'chained listener with a const event name',
      code: `${IMPORT}const FAILED = 'failed';
new Worker('m', run).on(FAILED, f);`,
    },
    {
      name: 'addListener counts like on',
      code: `${IMPORT}const w = new Worker('m', run);
w.addListener('failed', f);`,
    },
    {
      name: 'non-null assertion on the binding',
      code: `${IMPORT}let w: Worker | undefined;
w = new Worker('m', run);
w!.on('failed', f);`,
    },
    {
      name: 'non-null assertion on a this binding',
      code: `${IMPORT}class S {
  private worker?: Worker;
  init() {
    this.worker = new Worker('m', run);
    this.worker!.on('failed', f);
  }
}`,
    },
    {
      name: 'lazy assignment with a listener',
      code: `${IMPORT}class S {
  private worker?: Worker;
  get() {
    this.worker ??= new Worker('m', run);
    this.worker.on('failed', f);
  }
}`,
    },
    {
      name: 'chained assignment listened to through the local',
      code: `${IMPORT}class S {
  worker;
  init() {
    const worker = this.worker = new Worker('m', run);
    worker.on('failed', f);
  }
}`,
    },
    {
      name: 'field destructured from this',
      code: `${IMPORT}class S {
  worker = new Worker('m', run);
  init() {
    const { worker } = this;
    worker.on('failed', f);
  }
}`,
    },
    {
      name: 'listener in an arrow inside a method',
      code: `${IMPORT}class S {
  private worker = new Worker('m', run);
  onModuleInit() { setup(() => this.worker.on('failed', f)); }
}`,
    },
    {
      name: 'listener in a base class method',
      code: `${IMPORT}class Base {
  protected worker!: Worker;
  protected listen() { this.worker.on('failed', f); }
}
class Mail extends Base {
  constructor() {
    super();
    this.worker = new Worker('m', run);
    this.listen();
  }
}`,
    },
    {
      name: 'listener in a subclass for a base class field',
      code: `${IMPORT}class Base { protected worker = new Worker('m', run); }
class Mail extends Base {
  onModuleInit() { this.worker.on('failed', f); }
}`,
    },
    {
      name: 'listener in an abstract base for a subclass field',
      code: `${IMPORT}abstract class Base {
  protected abstract worker: Worker;
  protected wire() { this.worker.on('failed', f); }
}
class Mail extends Base { protected worker = new Worker('m', run); }`,
    },
    {
      name: 'listener in a grandparent class',
      code: `${IMPORT}class Root { protected worker!: Worker; wire() { this.worker.on('failed', f); } }
class Middle extends Root {}
class Mail extends Middle { init() { this.worker = new Worker('m', run); } }`,
    },
    {
      name: 'field worker in a class extending a base from another module',
      code: `${IMPORT}import { BaseWorkerService } from './base';
class Mail extends BaseWorkerService { protected worker = new Worker('m', run); }`,
    },
    {
      name: 'field worker in a class extending a declared class',
      code: `${IMPORT}declare class Base { protected wire(): void; }
class Mail extends Base { protected worker = new Worker('m', run); }`,
    },
    {
      name: 'listener through a const alias of this',
      code: `${IMPORT}class Mail {
  private worker = new Worker('m', run);
  onModuleInit() {
    const self = this;
    self.worker.on('failed', f);
  }
}`,
    },
    {
      name: 'prependListener counts like on',
      code: `${IMPORT}const w = new Worker('m', run);
w.prependListener('failed', f);`,
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
      name: 'const event name for another event',
      code: `${IMPORT}const COMPLETED = 'completed';
const w = new Worker('m', run);
w.on(COMPLETED, done);`,
      errors: [{ messageId: 'missingListener', data: { name: 'w', events: "'failed'" } }],
    },
    {
      name: 'once does not count',
      code: `${IMPORT}const w = new Worker('m', run);
w.once('failed', f);`,
      errors: [{ messageId: 'missingListener' }],
    },
    {
      name: 'same name in another function is another worker',
      code: `${IMPORT}function a() {
  const w = new Worker('a', run);
  w.on('failed', f);
}
function b() {
  const w = new Worker('b', run);
}`,
      errors: [{ messageId: 'missingListener', line: 7, data: { name: 'w', events: "'failed'" } }],
    },
    {
      name: 'escape in another function does not cover a worker of the same name',
      code: `${IMPORT}function a() {
  const w = new Worker('a', run);
  return w;
}
function b() {
  const w = new Worker('b', run);
}`,
      errors: [{ messageId: 'missingListener', line: 7 }],
    },
    {
      name: 'same field name in another class is another worker',
      code: `${IMPORT}class A { private worker = new Worker('a', run); }
class B {
  worker;
  init() { this.worker.on('failed', f); }
}`,
      errors: [{ messageId: 'missingListener', line: 2, data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'lazy assignment with no listener',
      code: `${IMPORT}class S {
  private worker?: Worker;
  get() { return (this.worker ??= new Worker('m', run)).name; }
}`,
      errors: [{ messageId: 'missingListener', data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'listener in a sibling class does not count',
      code: `${IMPORT}class Base { protected worker!: Worker; }
class A extends Base { init() { this.worker = new Worker('a', run); } }
class B extends Base { init() { this.worker.on('failed', f); } }`,
      errors: [{ messageId: 'missingListener', line: 3, data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'local worker in a class extending a base from another module',
      code: `${IMPORT}import { BaseService } from './base';
class Mail extends BaseService {
  start() { const w = new Worker('m', run); }
}`,
      errors: [{ messageId: 'missingListener', line: 4, data: { name: 'w', events: "'failed'" } }],
    },
    {
      name: 'reassigned alias of this does not count',
      code: `${IMPORT}class Mail {
  private worker = new Worker('m', run);
  onModuleInit(other) {
    let self = this;
    self = other;
    self.worker.on('failed', f);
  }
}`,
      errors: [{ messageId: 'missingListener', line: 3, data: { name: 'this.worker', events: "'failed'" } }],
    },
    {
      name: 'prependOnceListener does not count',
      code: `${IMPORT}const w = new Worker('m', run);
w.prependOnceListener('failed', f);`,
      errors: [{ messageId: 'missingListener', data: { name: 'w', events: "'failed'" } }],
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
