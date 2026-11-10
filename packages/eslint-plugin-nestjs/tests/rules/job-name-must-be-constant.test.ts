import { ruleTester } from '@noctcore/eslint-test-utils';

import { jobNameMustBeConstantRule } from '../../src/rules/job-name-must-be-constant';

ruleTester.run('job-name-must-be-constant', jobNameMustBeConstantRule, {
  valid: [
    { code: `@Processor(QUEUE_NAMES.EMAIL_DELIVERY) class P extends WorkerHost {}` },
    { code: `@Processor(EMAIL_QUEUE) class P extends WorkerHost {}` },
    { code: `@Processor({ name: QUEUE_NAMES.EMAIL }) class P extends WorkerHost {}` },
    { code: `class S { constructor(@InjectQueue(QUEUE_NAMES.EMAIL) private queue: Queue) {} }` },
    { code: `this.queue.add(JOB_NAMES.SEND_WELCOME, data);` },
    { code: `this.queue.add(\`\${prefix}-send\`, data);` },
    // Not a queue receiver.
    { code: `map.add('key', value);` },
    // A decorator the options do not list.
    {
      code: `class S { constructor(@InjectQueue('email') private queue: Queue) {} }`,
      options: [{ decorators: ['Processor'] }],
    },
    // Not a call decorator.
    { code: `@Processor class P {}` },
  ],
  invalid: [
    {
      code: `@Processor('email-delivery') class P extends WorkerHost {}`,
      errors: [{ messageId: 'mustBeConstant', data: { what: 'queue' } }],
    },
    {
      code: `@bull.Processor(\`email\`) class P extends WorkerHost {}`,
      errors: [{ messageId: 'mustBeConstant' }],
    },
    {
      code: `class S { constructor(@InjectQueue('email') private queue: Queue) {} }`,
      errors: [{ messageId: 'mustBeConstant', data: { what: 'queue' } }],
    },
    {
      code: `this.queue.add('send-welcome', data);`,
      errors: [{ messageId: 'mustBeConstant', data: { what: 'job' } }],
    },
    {
      code: `await this.mailQueue.add(\`send\`, data, { jobId });`,
      errors: [{ messageId: 'mustBeConstant' }],
    },
  ],
});
