import { ruleTester } from '@noctcore/eslint-test-utils';

import { addRequiresDedupeRule } from '../../src/rules/add-requires-dedupe';

const JOBS = `import { dedupe, InjectQueue, JobQueue } from '@noctcore/jobs';\n`;

ruleTester.run('add-requires-dedupe', addRequiresDedupeRule, {
  valid: [
    {
      name: 'a task queue field built with another constructor',
      code: `${JOBS}import PQueue from 'p-queue';
class Tasks {
  private readonly queue = new PQueue({ concurrency: 2 });
  run(kind: string) { return this.queue.add(() => kind, { priority: 1 }); }
}`,
    },
    {
      name: 'an object literal whose name looks like a queue',
      code: `${JOBS}const queueMetrics = { add(a, b) {} };
queueMetrics.add(\`m-\${kind}\`, 2);`,
    },
    {
      name: 'a parameter annotated with another type',
      code: `${JOBS}function track(queue: Counter) { return queue.add('x', 1); }`,
    },
    {
      name: 'a field annotated JobQueue or null still counts as a JobQueue',
      code: `${JOBS}class Mail {
  private queue: JobQueue<typeof mail> | null = null;
  send() { return this.queue!.add('x', d, { dedupe: dedupe.none() }); }
}`,
    },
    {
      name: 'dedupe.window',
      code: `${JOBS}await queue.add('x', d, { dedupe: dedupe.window(['order', id], '1h') });`,
    },
    {
      name: 'dedupe.none with a delay',
      code: `${JOBS}await this.queue.add('x', d, { dedupe: dedupe.none(), delay: '5m' });`,
    },
    {
      name: 'a dedupe choice held in a variable',
      code: `${JOBS}const choice = dedupe.until(id);
await this.queue.add('x', d, { dedupe: choice });`,
    },
    {
      name: 'options built elsewhere',
      code: `${JOBS}await this.queue.add('x', d, options);`,
    },
    {
      name: 'a spread that may carry dedupe',
      code: `${JOBS}await this.queue.add('x', d, { ...base, priority: 1 });`,
    },
    {
      name: 'spread arguments',
      code: `${JOBS}await this.queue.add(...args);`,
    },
    {
      name: 'a file that does not import the jobs package',
      code: `await this.queue.add('x', d, { jobId: \`order:\${id}\` });`,
    },
    {
      name: 'a BullMQ queue under a JobQueue',
      code: `${JOBS}await this.queue.bull.add('x', d, { jobId: id });`,
    },
    {
      name: 'a bullmq queue built in the file',
      code: `${JOBS}import { Queue } from 'bullmq';
const queue = new Queue('mail', { connection });
await queue.add('x', d, { jobId: id });`,
    },
    {
      name: 'a receiver whose name does not look like a queue',
      code: `${JOBS}await cache.add('x', d);`,
    },
    {
      name: 'a one-argument add is not an enqueue',
      code: `${JOBS}this.queue.add(() => task());`,
    },
  ],
  invalid: [
    {
      name: 'a field annotated JobQueue or null, assigned later',
      code: `${JOBS}class Mail {
  private queue: JobQueue<typeof mail> | null = null;
  send() { return this.queue!.add('x', d, { jobId: id }); }
}`,
      errors: [{ messageId: 'missingDedupe' }, { messageId: 'rawKey' }],
    },
    {
      name: 'a queue typed as any is still read by its name',
      code: `${JOBS}function enqueue(queue: any) { return queue.add('x', d); }`,
      errors: [{ messageId: 'missingDedupe' }],
    },
    {
      name: 'a raw jobId and no dedupe',
      code: `${JOBS}await queue.add('x', d, { jobId: \`order:\${id}\` });`,
      errors: [
        { messageId: 'missingDedupe', line: 2 },
        { messageId: 'rawKey', data: { key: 'jobId' }, line: 2 },
      ],
    },
    {
      name: 'a raw deduplication next to dedupe',
      code: `${JOBS}await queue.add('x', d, { dedupe: dedupe.none(), deduplication: { id } });`,
      errors: [{ messageId: 'rawKey', data: { key: 'deduplication' } }],
    },
    {
      name: 'no options at all',
      code: `${JOBS}await this.queue.add('x', d);`,
      errors: [{ messageId: 'missingDedupe' }],
    },
    {
      name: 'options without dedupe',
      code: `${JOBS}await this.queue.add('x', d, { delay: '5m' });`,
      errors: [{ messageId: 'missingDedupe' }],
    },
    {
      name: 'dedupe set to undefined',
      code: `${JOBS}await this.queue.add('x', d, { dedupe: undefined });`,
      errors: [{ messageId: 'missingDedupe' }],
    },
    {
      name: 'a JobQueue injected under a name that does not look like a queue',
      code: `${JOBS}class Orders {
  constructor(@InjectQueue(orders) private readonly orders: JobQueue<typeof orders>) {}
  place(id: string) { return this.orders.add('place', { id }, { jobId: id }); }
}`,
      errors: [{ messageId: 'missingDedupe' }, { messageId: 'rawKey' }],
    },
    {
      name: 'the queuePattern option',
      code: `${JOBS}await this.outbox.add('x', d);`,
      options: [{ queuePattern: 'outbox' }],
      errors: [{ messageId: 'missingDedupe' }],
    },
  ],
});
