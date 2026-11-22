import { ruleTester } from '@noctcore/eslint-test-utils';

import { noDynamicJobNameRule } from '../../src/rules/no-dynamic-job-name';

const JOBS = `import { dedupe, InjectQueue, JobQueue, Sweep } from '@noctcore/jobs';\n`;
const OPTS = `{ dedupe: dedupe.none() }`;

ruleTester.run('no-dynamic-job-name', noDynamicJobNameRule, {
  valid: [
    {
      name: 'a task queue field built with another constructor',
      code: `${JOBS}import PQueue from 'p-queue';
class Tasks {
  private readonly queue = new PQueue({ concurrency: 2 });
  run(kind: string) { return this.queue.add(\`task-\${kind}\`, { priority: 1 }); }
}`,
    },
    {
      name: 'an object literal whose name looks like a queue',
      code: `${JOBS}const queueMetrics = { add(a, b) {} };
queueMetrics.add(\`m-\${kind}\`, 2);`,
    },
    {
      name: 'a literal name',
      code: `${JOBS}await this.queue.add('send', { kind }, ${OPTS});`,
    },
    {
      name: 'a template with no substitutions',
      code: `${JOBS}await queue.add(\`send\`, data, ${OPTS});`,
    },
    {
      name: 'a const holding a literal',
      code: `${JOBS}const SEND = 'send';
await queue.add(SEND, data, ${OPTS});`,
    },
    {
      name: 'a parameter typed as one of the names',
      code: `${JOBS}function enqueue<N extends keyof MailJobs>(name: N, data: MailJobs[N]) {
  return this.queue.add(name, data, ${OPTS});
}`,
    },
    {
      name: 'a member of a constants object',
      code: `${JOBS}await queue.add(JOBS.send, data, ${OPTS});`,
    },
    {
      name: 'a conditional between two literals',
      code: `${JOBS}await queue.add(urgent ? 'send-now' : 'send', data, ${OPTS});`,
    },
    {
      name: 'a file that does not import the jobs package',
      code: `await this.queue.add(\`send-\${kind}\`, data, { jobId });`,
    },
    {
      name: 'a BullMQ queue under a JobQueue',
      code: `${JOBS}await this.queue.bull.add(\`send-\${kind}\`, data);`,
    },
    {
      name: 'a receiver annotated as a BullMQ queue',
      code: `${JOBS}import type { Queue } from 'bullmq';
function enqueue(queue: Queue) { return queue.add(\`send-\${kind}\`, data); }`,
    },
    {
      name: 'a receiver whose name does not look like a queue',
      code: `${JOBS}cache.add(\`key-\${id}\`, value);`,
    },
    {
      name: 'a one-argument add is not an enqueue',
      code: `${JOBS}this.queue.add(\`task-\${id}\`);`,
    },
    {
      name: 'a literal sweep name',
      code: `${JOBS}class Cleanup {
  @Sweep('token-cleanup', { cron: '0 * * * *', tz: 'UTC' })
  async run() {}
}`,
    },
    {
      name: 'a sweep name from a constant',
      code: `${JOBS}class Cleanup {
  @Sweep(SWEEPS.tokens, { every: '1h' })
  async run() {}
}`,
    },
    {
      name: 'a Sweep decorator from another module',
      code: `${JOBS}import { Sweep as Other } from './sweep';
class Cleanup {
  @Other(\`cleanup-\${env}\`, { every: '1h' })
  async run() {}
}`,
    },
  ],
  invalid: [
    {
      name: 'a template with a substitution',
      code: `${JOBS}await queue.add(\`send-\${kind}\`, data, ${OPTS});`,
      errors: [{ messageId: 'jobName', line: 2 }],
    },
    {
      name: 'a concatenation on this.queue',
      code: `${JOBS}await this.queue.add('send-' + kind, data, ${OPTS});`,
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'a call result',
      code: `${JOBS}await this.mailQueue.add(String(kind), data, ${OPTS});`,
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'an environment read',
      code: `${JOBS}await queue.add(process.env.JOB_NAME, data, ${OPTS});`,
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'one dynamic branch of a conditional',
      code: `${JOBS}await queue.add(urgent ? \`send-\${kind}\` : 'send', data, ${OPTS});`,
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'a JobQueue field whose name does not look like a queue',
      code: `${JOBS}class MailService {
  constructor(@InjectQueue(mail) private readonly mail: JobQueue<typeof mail>) {}
  send(kind: string) { return this.mail.add(\`send-\${kind}\`, {}, ${OPTS}); }
}`,
      errors: [{ messageId: 'jobName', line: 4 }],
    },
    {
      name: 'a parameter annotated JobQueue',
      code: `${JOBS}function enqueue(mail: JobQueue<typeof mail>, kind: string) {
  return mail.add(kind + '-mail', {}, ${OPTS});
}`,
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'the queuePattern option',
      code: `${JOBS}await this.outbox.add(\`send-\${kind}\`, data, ${OPTS});`,
      options: [{ queuePattern: 'outbox' }],
      errors: [{ messageId: 'jobName' }],
    },
    {
      name: 'a sweep name with a substitution',
      code: `${JOBS}class Cleanup {
  @Sweep(\`cleanup-\${process.env.REGION}\`, { every: '1h' })
  async run() {}
}`,
      errors: [{ messageId: 'sweepName', line: 3 }],
    },
    {
      name: 'a renamed Sweep import with a built name',
      code: `import { Sweep as Every } from '@noctcore/jobs';
class Cleanup {
  @Every('cleanup-' + hostname(), { every: '1h' })
  async run() {}
}`,
      errors: [{ messageId: 'sweepName' }],
    },
  ],
});
