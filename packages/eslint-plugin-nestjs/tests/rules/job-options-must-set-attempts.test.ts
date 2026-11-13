import { ruleTester } from '@noctcore/eslint-test-utils';

import { jobOptionsMustSetAttemptsRule } from '../../src/rules/job-options-must-set-attempts';

const IMPORT = `import { Queue } from 'bullmq';\n`;
const INJECTED = (body: string): string =>
  `class P {\n  constructor(private queue: Queue) {}\n  send() { ${body} }\n}`;

ruleTester.run('job-options-must-set-attempts', jobOptionsMustSetAttemptsRule, {
  valid: [
    {
      name: 'attempts with backoff',
      code: INJECTED(`this.queue.add('x', d, { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });`),
    },
    {
      name: 'a single attempt',
      code: INJECTED(`this.queue.add('x', d, { attempts: 1 });`),
    },
    {
      name: 'a single attempt with a type wrapper',
      code: INJECTED(`this.queue.add('x', d, { attempts: 1 as const });`),
    },
    {
      name: 'non-literal attempts',
      code: INJECTED(`this.queue.add('x', d, { attempts: MAX, backoff });`),
    },
    {
      name: 'non-literal attempts without backoff',
      code: INJECTED(`this.queue.add('x', d, { attempts: MAX });`),
    },
    {
      name: 'shorthand attempts without backoff',
      code: INJECTED(`this.queue.add('x', d, { attempts });`),
    },
    {
      name: 'attempts above 1 without backoff when requireBackoff is false',
      code: INJECTED(`this.queue.add('x', d, { attempts: 5 });`),
      options: [{ requireBackoff: false }],
    },
    {
      name: 'attempts from defaults, backoff from the call',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 3 } });
queue.add('x', d, { backoff: { type: 'fixed', delay: 500 } });`,
    },
    {
      name: 'backoff from defaults, attempts from the call',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { backoff: { type: 'fixed', delay: 500 } } });
queue.add('x', d, { attempts: 4 });`,
    },
    {
      name: 'defaults with attempts and backoff, call with no options',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 3, backoff: 1000 } });
queue.add('x', d);`,
    },
    {
      name: 'defaults from a renamed bullmq import',
      code: `import { Queue as BullQueue } from 'bullmq';
const queue = new BullQueue('m', { defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } });
queue.add('x', d);`,
    },
    {
      name: 'defaults with a satisfies wrapper',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 1 } satisfies JobsOptions });
queue.add('x', d);`,
    },
    {
      name: 'defaults on a field',
      code: `${IMPORT}class P {
  private queue = new Queue('m', { defaultJobOptions: { attempts: 1 } });
  send() { this.queue.add('x', d); }
}`,
    },
    {
      name: 'defaults assigned in the constructor',
      code: `${IMPORT}class P {
  private queue: Queue;
  constructor() { this.queue = new Queue('m', { defaultJobOptions: { attempts: 1 } }); }
  send() { this.queue.add('x', d); }
}`,
    },
    {
      name: 'defaults declared after the add',
      code: `${IMPORT}function send() { queue.add('x', d); }
const queue = new Queue('m', { defaultJobOptions: { attempts: 1 } });`,
    },
    {
      name: 'defaults from a base class in the file',
      code: `${IMPORT}class Base {
  protected queue: Queue;
  constructor() { this.queue = new Queue('m', { defaultJobOptions: { attempts: 1 } }); }
}
class P extends Base {
  send() { this.queue.add('x', d); }
}`,
    },
    {
      name: 'non-literal defaultJobOptions is skipped',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: shared });
queue.add('x', d);`,
    },
    {
      name: 'non-literal queue options are skipped',
      code: `${IMPORT}const queue = new Queue('m', opts);
queue.add('x', d);`,
    },
    {
      name: 'a spread in the queue options may hold defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { ...base });
queue.add('x', d);`,
    },
    {
      name: 'a spread in defaultJobOptions may hold attempts',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { ...retry } });
queue.add('x', d);`,
    },
    {
      name: 'a binding two queues are stored in is skipped',
      code: `${IMPORT}let queue = new Queue('a', { defaultJobOptions: { attempts: 1 } });
queue = new Queue('b');
queue.add('x', d);`,
    },
    {
      name: 'options passed by name are skipped',
      code: INJECTED(`this.queue.add('x', d, jobOptions);`),
    },
    {
      name: 'spread call arguments are skipped',
      code: INJECTED(`this.queue.add('x', ...rest);`),
    },
    {
      name: 'a spread may hold attempts',
      code: INJECTED(`this.queue.add('x', d, { priority: 1, ...base });`),
    },
    {
      name: 'a spread may hold backoff',
      code: INJECTED(`this.queue.add('x', d, { attempts: 5, ...base });`),
    },
    {
      name: 'FlowProducer add',
      code: `import { FlowProducer } from 'bullmq';
const flowQueue = new FlowProducer({ connection });
flowQueue.add({ name: 'x', queueName: 'q', data: d });`,
    },
    {
      name: 'FlowProducer bound to a queue-like name with two arguments',
      code: `import { FlowProducer } from 'bullmq';
const flowQueue = new FlowProducer({ connection });
flowQueue.add(flow, { queuesOptions });`,
    },
    {
      name: 'FlowProducer on a field',
      code: `import { FlowProducer } from 'bullmq';
class P {
  private flowQueue = new FlowProducer({ connection });
  send() { this.flowQueue.add(flow, opts); }
}`,
    },
    {
      name: 'add with a single argument',
      code: INJECTED(`this.queue.add(flow);`),
    },
    {
      name: 'not a queue receiver',
      code: `seen.add(value);`,
    },
    {
      name: 'custom queuePattern',
      code: INJECTED(`this.queue.add('x', d);`),
      options: [{ queuePattern: '^jobs$' }],
    },
    {
      name: 'bulk job without opts falls back to queue defaults',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 1 } });
queue.addBulk([{ name: 'x', data: d }]);`,
    },
    {
      name: 'bulk job with non-literal opts',
      code: INJECTED(`this.queue.addBulk([{ name, data, opts }]);`),
    },
    {
      name: 'bulk job with a spread and no opts',
      code: INJECTED(`this.queue.addBulk([{ name: 'x', data: d, ...rest }]);`),
    },
    {
      name: 'non-literal addBulk argument',
      code: INJECTED(`this.queue.addBulk(jobs);`),
    },
    {
      name: 'addBulk with no argument',
      code: INJECTED(`this.queue.addBulk();`),
    },
    {
      name: 'flow jobs in an addBulk',
      code: INJECTED(`this.queue.addBulk([{ name: 'x', queueName: 'q', data: d }, { name: 'y', data: d, children: [] }]);`),
    },
    {
      name: 'bulk jobs with attempts and backoff',
      code: INJECTED(
        `this.queue.addBulk(ids.map((id) => ({ name: 'x', data: { id }, opts: { attempts: 5, backoff: 1000 } })));`,
      ),
    },
  ],
  invalid: [
    {
      name: 'add with no options',
      code: INJECTED(`this.queue.add('x', d);`),
      errors: [{ messageId: 'missingAttempts', line: 3, column: 12 }],
    },
    {
      name: 'options without attempts',
      code: INJECTED(`this.queue.add('x', d, { priority: 1 });`),
      errors: [{ messageId: 'missingAttempts', line: 3, column: 35 }],
    },
    {
      name: 'attempts undefined counts as missing',
      code: INJECTED(`this.queue.add('x', d, { attempts: undefined });`),
      errors: [{ messageId: 'missingAttempts' }],
    },
    {
      name: 'attempts above 1 without backoff',
      code: INJECTED(`this.queue.add('x', d, { attempts: 5 });`),
      errors: [{ messageId: 'missingBackoff', line: 3, column: 35 }],
    },
    {
      name: 'attempts above 1 with backoff undefined',
      code: INJECTED(`this.queue.add('x', d, { attempts: 5, backoff: undefined });`),
      errors: [{ messageId: 'missingBackoff' }],
    },
    {
      name: 'attempts from defaults, no backoff anywhere',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 3 } });
queue.add('x', d);`,
      errors: [{ messageId: 'missingBackoff', line: 3 }],
    },
    {
      name: 'a Queue not imported from bullmq gives no defaults',
      code: `import { Queue } from './my-queue';
const queue = new Queue('m', { defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } });
queue.add('x', d);`,
      errors: [{ messageId: 'missingAttempts', line: 3 }],
    },
    {
      name: 'defaults on another queue do not count',
      code: `${IMPORT}const other = new Queue('o', { defaultJobOptions: { attempts: 1 } });
queue.add('x', d);`,
      errors: [{ messageId: 'missingAttempts', line: 3 }],
    },
    {
      name: 'a queue with no defaultJobOptions',
      code: `${IMPORT}const queue = new Queue('m', { connection });
queue.add('x', d);`,
      errors: [{ messageId: 'missingAttempts', line: 3 }],
    },
    {
      name: 'a queue constructed with a name only',
      code: `${IMPORT}const queue = new Queue('m');
queue.add('x', d);`,
      errors: [{ messageId: 'missingAttempts', line: 3 }],
    },
    {
      name: 'a spread elsewhere in the file does not count',
      code: `const base = { attempts: 3 };
${INJECTED(`this.queue.add('x', d, { priority: 1 });`)}`,
      errors: [{ messageId: 'missingAttempts', line: 4, column: 35 }],
    },
    {
      name: 'a subclass field does not give its base defaults',
      code: `${IMPORT}class Base {
  protected queue: Queue;
  send() { this.queue.add('x', d); }
}
class P extends Base {
  constructor() { super(); this.queue = new Queue('m', { defaultJobOptions: { attempts: 1 } }); }
}`,
      errors: [{ messageId: 'missingAttempts', line: 4 }],
    },
    {
      name: 'attempts above 1 without backoff with a custom queuePattern',
      code: `jobs.add('x', d, { attempts: 3 });`,
      options: [{ queuePattern: '^jobs$' }],
      errors: [{ messageId: 'missingBackoff' }],
    },
    {
      name: 'a this receiver at the top level of the file',
      code: `await this.mailQueue.add('x', d, { priority: 1 });`,
      errors: [{ messageId: 'missingAttempts' }],
    },
    {
      name: 'requireBackoff false still asks for attempts',
      code: INJECTED(`this.queue.add('x', d);`),
      options: [{ requireBackoff: false }],
      errors: [{ messageId: 'missingAttempts' }],
    },
    {
      name: 'bulk job without opts and no queue defaults',
      code: INJECTED(`this.queue.addBulk([{ name: 'x', data: d }]);`),
      errors: [{ messageId: 'missingAttempts', line: 3, column: 32 }],
    },
    {
      name: 'bulk job opts without attempts',
      code: INJECTED(
        `this.queue.addBulk([{ name: 'a', data: d, opts: { priority: 1 } }, { name: 'b', data: d, opts: { attempts: 1 } }]);`,
      ),
      errors: [{ messageId: 'missingAttempts', line: 3, column: 60 }],
    },
    {
      name: 'bulk jobs built by map',
      code: INJECTED(`this.queue.addBulk(ids.map((id) => ({ name: 'x', data: { id }, opts: { attempts: 5 } })));`),
      errors: [{ messageId: 'missingBackoff' }],
    },
    {
      name: 'bulk job without opts and queue defaults with attempts but no backoff',
      code: `${IMPORT}const queue = new Queue('m', { defaultJobOptions: { attempts: 2 } });
queue.addBulk([{ name: 'x', data: d }]);`,
      errors: [{ messageId: 'missingBackoff', line: 3 }],
    },
  ],
});
