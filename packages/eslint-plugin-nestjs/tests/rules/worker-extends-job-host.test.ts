import { ruleTester } from '@noctcore/eslint-test-utils';

import { workerExtendsJobHostRule } from '../../src/rules/worker-extends-job-host';
import { bullmqProjectFile, jobsProjectFile } from '../support/jobsProject';

const JOBS = `import { JobHost, Worker } from '@noctcore/jobs';\n`;
const NEST = `import { Processor, WorkerHost } from '@nestjs/bullmq';\n`;
const jobsApp = jobsProjectFile();
const bullmqApp = bullmqProjectFile();

ruleTester.run('worker-extends-job-host', workerExtendsJobHostRule, {
  valid: [
    {
      name: 'extends JobHost',
      code: `${JOBS}@Worker(mail)
class MailWorker extends JobHost<typeof mail> {
  async handle(job) {}
}`,
    },
    {
      name: 'renamed imports',
      code: `import { JobHost as Host, Worker as JobWorker } from '@noctcore/jobs';
@JobWorker(mail)
class MailWorker extends Host<typeof mail> {
  async handle(job) {}
}`,
    },
    {
      name: 'extends a local base that extends JobHost',
      code: `${JOBS}abstract class AuditedWorker<Q> extends JobHost<Q> {}
@Worker(mail)
class MailWorker extends AuditedWorker<typeof mail> {
  async handle(job) {}
}`,
    },
    {
      name: 'extends a base imported from another module',
      code: `import { Worker } from '@noctcore/jobs';
import { BaseWorker } from './base-worker';
@Worker(mail)
class MailWorker extends BaseWorker<typeof mail> {
  async handle(job) {}
}`,
    },
    {
      name: 'a Worker decorator that is not from the jobs package',
      code: `import { Worker } from './decorators';
@Worker(mail)
class MailWorker {
  process(job) {}
}`,
    },
    {
      name: 'a local Worker shadows the import',
      code: `${JOBS}function make(Worker) {
  @Worker(mail)
  class MailWorker {}
  return MailWorker;
}`,
    },
    {
      name: 'a class with no decorator',
      code: `${JOBS}class Helper {}`,
    },
    {
      name: 'a NestJS processor in an app without the jobs package',
      code: `${NEST}@Processor('mail')
class MailProcessor extends WorkerHost {
  async process(job) {}
}`,
      filename: bullmqApp,
    },
    {
      name: 'a NestJS processor in a file with no project manifest declaring jobs',
      code: `${NEST}@Processor('mail')
class MailProcessor extends WorkerHost {
  async process(job) {}
}`,
    },
    {
      name: 'a Processor decorator from another module in a jobs app',
      code: `import { Processor } from './processor';
@Processor('mail')
class MailProcessor {}`,
      filename: jobsApp,
    },
  ],
  invalid: [
    {
      name: 'no base class',
      code: `${JOBS}@Worker(mail)
class MailWorker {
  process(job) {}
}`,
      errors: [{ messageId: 'mustExtendJobHost', line: 3 }],
    },
    {
      name: 'renamed Worker import with no base class',
      code: `import { Worker as JobWorker } from '@noctcore/jobs';
@JobWorker(mail)
class MailWorker {}`,
      errors: [{ messageId: 'mustExtendJobHost' }],
    },
    {
      name: 'a local base chain that never reaches JobHost',
      code: `${JOBS}class Base {}
@Worker(mail)
class MailWorker extends Base {}`,
      errors: [{ messageId: 'mustExtendJobHost' }],
    },
    {
      name: 'extends the NestJS WorkerHost',
      code: `${JOBS}${NEST}@Worker(mail)
class MailWorker extends WorkerHost {
  async process(job) {}
}`,
      errors: [{ messageId: 'mustExtendJobHost' }],
    },
    {
      name: 'an anonymous class expression',
      code: `${JOBS}export const MailWorker = @Worker(mail) class {};`,
      errors: [{ messageId: 'mustExtendJobHost' }],
    },
    {
      name: 'a NestJS processor in a file that imports the jobs package',
      code: `${JOBS}${NEST}@Processor('mail')
class MailProcessor extends WorkerHost {
  async process(job) {}
}`,
      errors: [{ messageId: 'nestProcessor', line: 3 }],
    },
    {
      name: 'a NestJS processor in a project that declares the jobs package',
      code: `${NEST}@Processor('mail')
class MailProcessor extends WorkerHost {
  async process(job) {}
}`,
      filename: jobsApp,
      errors: [{ messageId: 'nestProcessor' }],
    },
    {
      name: 'a WorkerHost subclass with no Processor decorator in a jobs app',
      code: `import { WorkerHost as Host } from '@nestjs/bullmq';
export abstract class BaseProcessor extends Host {}`,
      filename: jobsApp,
      errors: [{ messageId: 'nestProcessor' }],
    },
  ],
});
