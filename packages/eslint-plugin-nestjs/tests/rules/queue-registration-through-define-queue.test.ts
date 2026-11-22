import { ruleTester } from '@noctcore/eslint-test-utils';

import { queueRegistrationThroughDefineQueueRule } from '../../src/rules/queue-registration-through-define-queue';
import { bullmqProjectFile, jobsProjectFile } from '../support/jobsProject';

const JOBS = `import { defineQueue, expo, JobsModule } from '@noctcore/jobs';\n`;
const jobsApp = jobsProjectFile();
const bullmqApp = bullmqProjectFile();

ruleTester.run('queue-registration-through-define-queue', queueRegistrationThroughDefineQueueRule, {
  valid: [
    {
      name: 'defineQueue and forFeature',
      code: `${JOBS}export const mail = defineQueue<MailJobs>('mail', {
  attempts: 5,
  backoff: expo('2s'),
  keep: { completed: '1h', failed: '7d' },
  concurrency: 5,
});
JobsModule.forFeature([mail]);`,
    },
    {
      name: 'a hand-built queue in a project without the jobs package',
      code: `import { Queue, Worker } from 'bullmq';
const mail = new Queue('mail', { connection });
const worker = new Worker('mail', run, { connection });`,
      filename: bullmqApp,
    },
    {
      name: 'BullModule.registerQueue in a project without the jobs package',
      code: `import { BullModule } from '@nestjs/bullmq';
BullModule.registerQueue({ name: 'mail' });`,
      filename: bullmqApp,
    },
    {
      name: 'a hand-built queue with no manifest declaring jobs',
      code: `import { Queue } from 'bullmq';
const mail = new Queue('mail', { connection });`,
    },
    {
      name: 'a Worker that is not from bullmq',
      code: `${JOBS}import { Worker } from 'node:worker_threads';
const thread = new Worker('./task.js');`,
    },
    {
      name: 'a FlowProducer is not reported',
      code: `${JOBS}import { FlowProducer } from 'bullmq';
const flows = new FlowProducer({ connection });`,
    },
    {
      name: 'a BullModule that is not from @nestjs/bullmq',
      code: `${JOBS}import { BullModule } from './bull';
BullModule.registerQueue({ name: 'mail' });`,
    },
    {
      name: 'BullModule.forRoot is not a queue registration',
      code: `${JOBS}import { BullModule } from '@nestjs/bullmq';
BullModule.forRoot({ connection });`,
    },
    {
      name: 'a file listed in allowIn',
      code: `import { Queue } from 'bullmq';
const probe = new Queue('mail', { connection });`,
      filename: jobsApp,
      options: [{ allowIn: ['**/mail.service.ts'] }],
    },
  ],
  invalid: [
    {
      name: 'new Queue in a file that imports the jobs package',
      code: `${JOBS}import { Queue } from 'bullmq';
const mail = new Queue('mail', { connection });`,
      errors: [{ messageId: 'handBuilt', data: { name: 'Queue' }, line: 3 }],
    },
    {
      name: 'new Queue, Worker and QueueEvents in a jobs project',
      code: `import { Queue as BullQueue, QueueEvents, Worker } from 'bullmq';
const mail = new BullQueue('mail', { connection });
const worker = new Worker('mail', run, { connection });
const events = new QueueEvents('mail', { connection });`,
      filename: jobsApp,
      errors: [
        { messageId: 'handBuilt', data: { name: 'Queue' } },
        { messageId: 'handBuilt', data: { name: 'Worker' } },
        { messageId: 'handBuilt', data: { name: 'QueueEvents' } },
      ],
    },
    {
      name: 'BullModule.registerQueue and registerQueueAsync in a jobs project',
      code: `import { BullModule } from '@nestjs/bullmq';
@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    BullModule.registerQueueAsync({ name: 'reports', useFactory }),
  ],
})
export class MailModule {}`,
      filename: jobsApp,
      errors: [
        { messageId: 'registerQueue', data: { name: 'registerQueue' }, line: 4 },
        { messageId: 'registerQueue', data: { name: 'registerQueueAsync' }, line: 5 },
      ],
    },
  ],
});
