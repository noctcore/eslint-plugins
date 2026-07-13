import { ruleTester } from '@noctcore/eslint-test-utils';

import { structuredLogArgumentsRule } from '../../src/rules/structured-log-arguments';

const TS = 'service.ts';

ruleTester.run('structured-log-arguments', structuredLogArgumentsRule, {
  valid: [
    // Static message + a structured context object — the target shape.
    { code: `logger.info('processing task', { taskId });`, filename: TS },
    // A template with no expressions carries no dynamic value.
    { code: 'logger.info(`ready`);', filename: TS },
    // `console.log` uses a non-level method (`log`), out of scope by spec.
    { code: 'console.log(`x=${x}`);', filename: TS },
    // A template nested inside a context object builds a value, not the message.
    { code: 'logger.info(`msg`, { url: `${base}/x` });', filename: TS },
    // An unknown object is not a configured logger.
    { code: 'metrics.info(`${x}`);', filename: TS },
    // Not a logger call at all.
    { code: 'format(`${x}`);', filename: TS },
    // A configured custom logger set excludes the default names.
    {
      code: 'logger.info(`${x}`);',
      filename: TS,
      options: [{ loggers: ['audit'] }],
    },
  ],
  invalid: [
    // Dynamic value fused into the message string.
    {
      code: 'logger.info(`processing task ${taskId}`);',
      filename: TS,
      errors: [{ messageId: 'interpolatedMessage' }],
    },
    {
      code: 'console.error(`failed: ${err.message}`);',
      filename: TS,
      errors: [{ messageId: 'interpolatedMessage' }],
    },
    {
      code: 'log.debug(`x=${x}`);',
      filename: TS,
      errors: [{ messageId: 'interpolatedMessage' }],
    },
    // A logger held on `this` is still a logger.
    {
      code: 'this.logger.warn(`${a} then ${b}`);',
      filename: TS,
      errors: [{ messageId: 'interpolatedMessage' }],
    },
    // A configured custom logger is scanned.
    {
      code: 'audit.info(`${x}`);',
      filename: TS,
      options: [{ loggers: ['audit'] }],
      errors: [{ messageId: 'interpolatedMessage' }],
    },
  ],
});
