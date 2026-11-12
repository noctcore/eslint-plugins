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
      name: 'static method does not attribute this to an instance field',
      code: `${IMPORT}class S { static make() { this.w = new Worker('m', run); } }`,
    },
    {
      name: 'close delegated to a helper method',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { await this.stopWorkers(); }
  private async stopWorkers() { await this.w.close(); }
}`,
    },
    {
      name: 'close delegated through two helpers and an arrow field',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { await this.stopAll(); }
  private stopAll = async () => { await this.stopWorker(); };
  private async stopWorker() { await this.w.close(); }
}`,
    },
    {
      name: 'helpers that call each other do not loop',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { await this.a(); }
  private async a() { await this.b(); }
  private async b() { await this.a(); await this.w.close(); }
}`,
    },
    {
      name: 'close through a local alias',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() {
    const worker = this.w;
    await worker.close();
  }
}`,
    },
    {
      name: 'close through a destructured field',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() {
    const { w } = this;
    await w.close();
  }
}`,
    },
    {
      name: 'close through a renamed destructured field',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() {
    const { w: worker } = this;
    await worker.close();
  }
}`,
    },
    {
      name: 'non-null assertion on the field',
      code: `${IMPORT}class Mail {
  private w?: Worker;
  onModuleInit() { this.w = new Worker('m', run); }
  async onModuleDestroy() { await this.w!.close(); }
}`,
    },
    {
      name: 'lazy assignment closed',
      code: `${IMPORT}class Mail {
  private w?: Worker;
  get() { return (this.w ??= new Worker('m', run)); }
  async onModuleDestroy() { await this.w?.close(); }
}`,
    },
    {
      name: 'close inherited from a base class in the file',
      code: `${IMPORT}class Base {
  protected w!: Worker;
  async onModuleDestroy() { await this.w.close(); }
}
class Mail extends Base {
  constructor() {
    super();
    this.w = new Worker('m', run);
  }
}`,
    },
    {
      name: 'override that calls the base close method',
      code: `${IMPORT}class Base {
  protected w!: Worker;
  async onModuleDestroy() { await this.w.close(); }
}
class Mail extends Base {
  protected w = new Worker('m', run);
  async onModuleDestroy() {
    log.info('closing');
    await super.onModuleDestroy();
  }
}`,
    },
    {
      name: 'base class from another module may close it',
      code: `${IMPORT}import { WorkerService } from './worker-service';
class Mail extends WorkerService { private w = new Worker('m', run); }`,
    },
    {
      name: 'abstract close method is implemented by a subclass',
      code: `${IMPORT}abstract class MailBase {
  protected w = new Worker('m', run);
  abstract close(): Promise<void>;
}`,
    },
    {
      name: 'overload signatures before the close method',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  close(): Promise<void>;
  close(force?: boolean): Promise<void> { return this.w.close(force); }
}`,
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
      errors: [
        {
          messageId: 'missingClose',
          data: { field: 'w', methods: DEFAULT_METHODS, suggested: 'onModuleDestroy' },
        },
      ],
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
      name: 'message names the configured close method',
      code: `${IMPORT}class Mail { private w = new Worker('m', run); }`,
      options: [{ closeMethodNames: ['stop', 'halt'] }],
      errors: [
        { messageId: 'missingClose', data: { field: 'w', methods: '`stop` / `halt`', suggested: 'stop' } },
      ],
    },
    {
      name: 'getter named close does not count',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  get close() { return this.w.close(); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'lazy assignment with no close method',
      code: `${IMPORT}class Mail {
  private w?: Worker;
  get() { return (this.w ??= new Worker('m', run)); }
}`,
      errors: [{ messageId: 'missingClose', data: { field: 'w', methods: DEFAULT_METHODS, suggested: 'onModuleDestroy' } }],
    },
    {
      name: 'helper that never closes the worker',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { await this.flush(); }
  private async flush() { log.info('bye'); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'closing helper that no close method calls',
      code: `${IMPORT}class Mail {
  private w = new Worker('m', run);
  async onModuleDestroy() { log.info('bye'); }
  private async stopWorker() { await this.w.close(); }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'local alias of another field',
      code: `import { Worker, Queue } from 'bullmq';
class Mail {
  private w = new Worker('m', run);
  private q = new Queue('m');
  async onModuleDestroy() {
    const queue = this.q;
    await queue.close();
  }
}`,
      errors: [{ messageId: 'missingClose' }],
    },
    {
      name: 'override that drops the base close',
      code: `${IMPORT}class Base {
  protected w!: Worker;
  async onModuleDestroy() { await this.w.close(); }
}
class Mail extends Base {
  protected w = new Worker('m', run);
  async onModuleDestroy() { log.info('bye'); }
}`,
      errors: [{ messageId: 'missingClose', line: 7 }],
    },
    {
      name: 'base class in the file that does not close',
      code: `${IMPORT}class Base {
  async onModuleDestroy() { log.info('bye'); }
}
class Mail extends Base { private w = new Worker('m', run); }`,
      errors: [{ messageId: 'missingClose', line: 5 }],
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
