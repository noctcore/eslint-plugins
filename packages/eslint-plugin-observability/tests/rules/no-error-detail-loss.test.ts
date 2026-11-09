import { ruleTester } from '@noctcore/eslint-test-utils';

import { noErrorDetailLossRule } from '../../src/rules/no-error-detail-loss';

const TS = 'service.ts';

ruleTester.run('no-error-detail-loss', noErrorDetailLossRule, {
  valid: [
    // A method outside a narrowed set is not a logger call.
    {
      code: `try { run(); } catch (e) { this.logger.log(e.message); }`,
      filename: TS,
      options: [{ methods: ['error'] }],
    },
    // The error is passed whole in a structured field — diagnostics survive.
    {
      code: `try { run(); } catch (e) { logger.error('failed', { err: e }); }`,
      filename: TS,
    },
    // The error is passed whole as a bare argument.
    {
      code: `try { run(); } catch (e) { logger.error('failed', e); }`,
      filename: TS,
    },
    // `.stack` is read — that is not a lossy form.
    {
      code: 'try { run(); } catch (e) { logger.error(`failed: ${e.stack}`); }',
      filename: TS,
    },
    // Mixed lossy + full use: the full use preserves the error.
    {
      code: 'try { run(); } catch (e) { logger.error(`${e.message}`, { err: e }); }',
      filename: TS,
    },
    // An unused catch binding is a different concern (not this rule).
    {
      code: `try { run(); } catch (e) { cleanup(); }`,
      filename: TS,
    },
    // No logging at all — nothing is "reporting a failure" here.
    {
      code: `try { run(); } catch (e) { throw e; }`,
      filename: TS,
    },
  ],
  invalid: [
    // Logs only `e.message`.
    {
      code: `try { run(); } catch (e) { logger.error(e.message); }`,
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // String-concat of only the message.
    {
      code: `try { run(); } catch (e) { logger.error('failed: ' + e.message); }`,
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // Template interpolation of only the message.
    {
      code: 'try { run(); } catch (e) { logger.warn(`boom: ${e.message}`); }',
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // `String(e)` stringification.
    {
      code: `try { run(); } catch (e) { console.error(String(e)); }`,
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // Bare `${e}` interpolation loses the stack just the same.
    {
      code: 'try { run(); } catch (e) { logger.error(`${e}`); }',
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // Nest's `logger.log` and pino's `fatal` are logger calls.
    {
      code: `try { run(); } catch (e) { this.logger.log(e.message); }`,
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    {
      code: `try { run(); } catch (e) { logger.fatal(e.message); }`,
      filename: TS,
      errors: [{ messageId: 'detailLoss' }],
    },
    // A configured logger name.
    {
      code: `try { run(); } catch (e) { pino.error(e.message); }`,
      filename: TS,
      options: [{ loggers: ['pino'] }],
      errors: [{ messageId: 'detailLoss' }],
    },
  ],
});
