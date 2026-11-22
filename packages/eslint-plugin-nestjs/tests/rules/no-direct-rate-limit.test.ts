import { ruleTester } from '@noctcore/eslint-test-utils';

import { noDirectRateLimitRule } from '../../src/rules/no-direct-rate-limit';
import { bullmqProjectFile, jobsProjectFile } from '../support/jobsProject';

const JOBS = `import { JobHost, Worker } from '@noctcore/jobs';\n`;
const jobsApp = jobsProjectFile();
const bullmqApp = bullmqProjectFile();

ruleTester.run('no-direct-rate-limit', noDirectRateLimitRule, {
  valid: [
    {
      name: 'pauseQueue in a JobHost',
      code: `${JOBS}@Worker(mail)
class MailWorker extends JobHost<typeof mail> {
  async handle(job) {
    throw await this.pauseQueue(5000);
  }
}`,
    },
    {
      name: 'pauseFor on a JobQueue',
      code: `${JOBS}await this.queue.pauseFor(60_000);`,
    },
    {
      name: 'rateLimit on a receiver the file says nothing about',
      code: `${JOBS}await limiter.rateLimit(5000);`,
    },
    {
      name: 'a RateLimitError call on the jobs Worker is not the bullmq one',
      code: `${JOBS}throw Worker.RateLimitError();`,
    },
    {
      name: 'a raw rateLimit in a project without the jobs package',
      code: `import { Worker } from 'bullmq';
const worker = new Worker('mail', run, { connection });
await worker.rateLimit(5000);
throw Worker.RateLimitError();`,
      filename: bullmqApp,
    },
    {
      name: 'a raw rateLimit with no manifest declaring jobs',
      code: `import { Queue } from 'bullmq';
const queue = new Queue('mail', { connection });
await queue.rateLimit(5000);`,
    },
    {
      name: 'a file listed in allowIn',
      code: `${JOBS}await this.queue.bull.rateLimit(5000);`,
      filename: 'src/admin/limits.ts',
      options: [{ allowIn: ['src/admin/**'] }],
    },
  ],
  invalid: [
    {
      name: 'rateLimit on queue.bull',
      code: `${JOBS}await queue.bull.rateLimit(5000);`,
      errors: [{ messageId: 'rateLimitCall', line: 2 }],
    },
    {
      name: 'Worker.RateLimitError from bullmq',
      code: `import { Worker } from 'bullmq';
throw Worker.RateLimitError();`,
      filename: jobsApp,
      errors: [{ messageId: 'rateLimitError' }],
    },
    {
      name: 'a renamed bullmq Worker and a bullmq worker binding',
      code: `import { Worker as BullWorker } from 'bullmq';
const worker = new BullWorker('mail', async () => {
  await worker.rateLimit(5000);
  throw BullWorker.RateLimitError();
}, { connection });`,
      filename: jobsApp,
      errors: [{ messageId: 'rateLimitCall', line: 3 }, { messageId: 'rateLimitError', line: 4 }],
    },
    {
      name: 'new RateLimitError from bullmq',
      code: `${JOBS}import { RateLimitError } from 'bullmq';
throw new RateLimitError();`,
      errors: [{ messageId: 'rateLimitError' }],
    },
    {
      name: 'this.worker in a NestJS WorkerHost',
      code: `import { Processor, WorkerHost } from '@nestjs/bullmq';
@Processor('mail')
class MailProcessor extends WorkerHost {
  async process(job) {
    await this.worker.rateLimit(5000);
  }
}`,
      filename: jobsApp,
      errors: [{ messageId: 'rateLimitCall', line: 5 }],
    },
    {
      name: 'a queue injected with the NestJS InjectQueue',
      code: `${JOBS}import { InjectQueue } from '@nestjs/bullmq';
class Mail {
  constructor(@InjectQueue('mail') private readonly mail) {}
  slowDown() { return this.mail.rateLimit(5000); }
}`,
      errors: [{ messageId: 'rateLimitCall', line: 5 }],
    },
  ],
});
