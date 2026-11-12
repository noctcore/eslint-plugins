import { ruleTester } from '@noctcore/eslint-test-utils';

import { workerMustImplementCloseRule } from '../../src/rules/worker-must-implement-close';

const IMPORT = `import { Worker } from 'bullmq';\n`;

const DEFAULT_METHODS =
  '`close` / `shutdown` / `dispose` / `onModuleDestroy` / `onApplicationShutdown` / `beforeApplicationShutdown`';

const closesIn = (method: string): string => `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async ${method}() { await this.w.close(); }
}`;

ruleTester.run('worker-must-implement-close', workerMustImplementCloseRule, {
  valid: [
    { name: 'onModuleDestroy awaits close', code: closesIn('onModuleDestroy') },
    { name: 'close method', code: closesIn('close') },
    { name: 'shutdown method', code: closesIn('shutdown') },
    { name: 'dispose method', code: closesIn('dispose') },
    { name: 'onApplicationShutdown method', code: closesIn('onApplicationShutdown') },
    { name: 'beforeApplicationShutdown method', code: closesIn('beforeApplicationShutdown') },
    {
      name: 'close method written before the field',
      code: `${IMPORT}class Mail {
  async onModuleDestroy() { await this.w.close(); }
  private w = new Worker('m', run);
}`,
    },
    {
      name: 'close inside Promise.all and optional chaining',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { await Promise.all([this.w?.close()]); }
}`,
    },
    {
      name: 'close not awaited',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  onModuleDestroy() { void this.w.close(); }
}`,
    },
    {
      name: 'arrow-valued close field',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  onModuleDestroy = async () => { await this.w.close(); };
}`,
    },
    {
      name: 'assigned in a method and closed',
      code: `${IMPORT}class Mail {
  w;
  onModuleInit() { this.w = new Worker('mail', run); }
  async onModuleDestroy() { await this.w.close(); }
}`,
    },
    {
      name: 'assigned in the constructor and closed',
      code: `${IMPORT}class Mail {
  constructor() { this.w = new Worker('mail', run); }
  async onModuleDestroy() { await this.w.close(); }
}`,
    },
    {
      name: 'chained listener on the field',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run).on('failed', f);
  async close() { await this.w.close(); }
}`,
    },
    {
      name: 'closeMethodNames replaces the defaults',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async stop() { await this.w.close(); }
}`,
      options: [{ closeMethodNames: ['stop'] }],
    },
    {
      name: 'Processor extending WorkerHost',
      code: `import { Processor, WorkerHost } from '@nestjs/bullmq';
@Processor(QUEUE)
class P extends WorkerHost {
  async process() {}
}`,
    },
    {
      name: 'worker in a local, not a field',
      code: `${IMPORT}class S { run() { const w = new Worker('m', run); } }`,
    },
    {
      name: 'this inside a nested function is not the class',
      code: `${IMPORT}class S {
  run() {
    function make() { this.w = new Worker('m', run); }
  }
}`,
    },
    {
      name: 'static field is not an instance worker',
      code: `${IMPORT}class S { static w = new Worker('m', run); }`,
    },
    {
      name: 'Worker not from bullmq is ignored',
      code: `import { Worker } from 'node:worker_threads';
class Pool { private w = new Worker(file); }`,
    },
    {
      name: 'other bullmq classes are not workers',
      code: `import { Queue } from 'bullmq';
class Mail { private q = new Queue('m'); }`,
    },
  ],
  invalid: [
    {
      name: 'field with no close method',
      code: `${IMPORT}class Mail { private w = new Worker('mail', run); }`,
      errors: [{ messageId: 'missingClose', line: 2, column: 26 }],
    },
    {
      name: 'assigned in a method with no close method',
      code: `${IMPORT}class Mail {
  w;
  onModuleInit() { this.w = new Worker('mail', run); }
}`,
      errors: [{ messageId: 'missingClose', line: 4 }],
    },
    {
      name: 'assigned in an arrow inside a method',
      code: `${IMPORT}class Mail {
  w;
  onModuleInit() { setup(() => { this.w = new Worker('mail', run); }); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'close method that never closes the worker',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { log.info('bye'); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'closes a different field',
      code: `import { Worker, Queue } from 'bullmq';
class Mail {
  private w = new Worker('m', run);
  private q = new Queue('m');
  async onModuleDestroy() { await this.q.close(); }
}`,
      errors: [{ messageId: 'missingClose', data: { field: 'w', methods: DEFAULT_METHODS } }],
    },
    {
      name: 'close in a method not in closeMethodNames',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async stop() { await this.w.close(); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'closeMethodNames drops the default names',
      code: closesIn('onModuleDestroy'),
      options: [{ closeMethodNames: ['stop'] }],
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'static close method does not count',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  static async close() { await this.w.close(); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'renamed import is resolved',
      code: `import { Worker as BullWorker } from 'bullmq';
class Mail { private w = new BullWorker('mail', run); }`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'class expression',
      code: `${IMPORT}export const Mail = class { private w = new Worker('mail', run); };`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'each unclosed worker is reported',
      code: `${IMPORT}class Mail {
  private a = new Worker('a', run);
  private b = new Worker('b', run);
  async onModuleDestroy() { await this.a.close(); }
}`,
      errors: [{ messageId: 'missingClose', line: 4 }],
    },
  ],
});
