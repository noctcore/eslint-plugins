import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRawBullmqQueueAddRule } from '../../src/rules/no-raw-bullmq-queue-add';
import { bullmqProjectFile, jobsProjectFile } from '../support/jobsProject';

const JOBS = `import { dedupe, InjectQueue, JobQueue } from '@noctcore/jobs';\n`;
const BULLMQ = `import { Queue } from 'bullmq';\n`;
const jobsApp = jobsProjectFile();
const bullmqApp = bullmqProjectFile();

ruleTester.run('no-raw-bullmq-queue-add', noRawBullmqQueueAddRule, {
  valid: [
    {
      name: 'add on the JobQueue',
      code: `${JOBS}await this.queue.add('x', data, { dedupe: dedupe.until(id) });`,
    },
    {
      name: 'reads through the BullMQ queue',
      code: `${JOBS}const waiting = await this.queue.bull.getWaitingCount();
const job = await this.queue.bull.getJob(id);`,
    },
    {
      name: 'a receiver the file says nothing about',
      code: `${JOBS}await this.emailQueue.add('x', data, { jobId: id });`,
    },
    {
      name: 'a FlowProducer is not a queue',
      code: `${JOBS}import { FlowProducer } from 'bullmq';
const flows = new FlowProducer({ connection });
await flows.add({ name: 'x', queueName: 'q' });`,
    },
    {
      name: 'a raw add in a file and project without the jobs package',
      code: `${BULLMQ}const mail = new Queue('mail', { connection });
await mail.add('x', data, { jobId: id });`,
      filename: bullmqApp,
    },
    {
      name: 'a raw add in a file without a manifest declaring jobs',
      code: `${BULLMQ}const mail = new Queue('mail', { connection });
await mail.add('x', data);`,
    },
    {
      name: 'a file listed in allowIn',
      code: `${JOBS}await this.queue.bull.add('x', data);`,
      filename: 'scripts/seed.ts',
      options: [{ allowIn: ['scripts/**'] }],
    },
    {
      name: 'a Queue that is not from bullmq',
      code: `${JOBS}import { Queue } from './queue';
const q = new Queue();
q.add('x', data);`,
    },
  ],
  invalid: [
    {
      name: 'add on queue.bull',
      code: `${JOBS}await this.queue.bull.add('x', data, { jobId: id });`,
      errors: [{ messageId: 'rawAdd', data: { method: 'add' }, line: 2 }],
    },
    {
      name: 'addBulk on queue.bull',
      code: `${JOBS}await queue.bull.addBulk([{ name: 'x', data }]);`,
      errors: [{ messageId: 'rawAdd', data: { method: 'addBulk' } }],
    },
    {
      name: 'a bullmq queue built in the file, in a jobs project',
      code: `${BULLMQ}const mail = new Queue('mail', { connection });
await mail.add('x', data);`,
      filename: jobsApp,
      errors: [{ messageId: 'rawAdd' }],
    },
    {
      name: 'a renamed bullmq import stored on this',
      code: `import { Queue as BullQueue } from 'bullmq';
class Mail {
  private queue;
  init() { this.queue = new BullQueue('mail', { connection }); }
  send() { return this.queue.add('x', data); }
}`,
      filename: jobsApp,
      errors: [{ messageId: 'rawAdd' }],
    },
    {
      name: 'a queue injected with the NestJS InjectQueue',
      code: `${JOBS}import { InjectQueue as NestInjectQueue } from '@nestjs/bullmq';
class Mail {
  constructor(@NestInjectQueue('mail') private readonly mail) {}
  send() { return this.mail.add('x', data); }
}`,
      errors: [{ messageId: 'rawAdd', line: 5 }],
    },
    {
      name: 'a parameter annotated with the bullmq Queue type',
      code: `import type { Queue } from 'bullmq';
export function enqueue(target: Queue) { return target.add('x', data); }`,
      filename: jobsApp,
      errors: [{ messageId: 'rawAdd' }],
    },
    {
      name: 'a field annotated with the bullmq Queue type',
      code: `${JOBS}import type { Queue } from 'bullmq';
class Mail {
  private readonly outbox!: Queue;
  send() { return this.outbox.addBulk(jobs); }
}`,
      errors: [{ messageId: 'rawAdd', data: { method: 'addBulk' } }],
    },
  ],
});
