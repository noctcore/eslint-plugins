import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireEventFieldRule } from '../../src/rules/require-event-field';

const TS = 'service.ts';

ruleTester.run('require-event-field', requireEventFieldRule, {
  valid: [
    // The target shape, payload first (pino) or second.
    { code: `log.info({ event: 'invoice.paid', invoiceId }, 'paid');`, filename: TS },
    { code: `logger.info('paid', { event: 'invoice.paid', invoiceId });`, filename: TS },
    // A string-literal key counts.
    { code: `log.info({ 'event': 'invoice.paid' }, 'paid');`, filename: TS },
    // Shorthand counts.
    { code: `log.info({ event, invoiceId });`, filename: TS },
    // One of several object literals carrying the field is enough.
    { code: `log.info({ invoiceId }, 'paid', { event: 'invoice.paid' });`, filename: TS },
    // A spread may supply the field.
    { code: `log.info({ ...ctx, invoiceId }, 'paid');`, filename: TS },
    // So may a computed key.
    { code: `log.info({ [EVENT_KEY]: 'invoice.paid' }, 'paid');`, filename: TS },
    // A payload built elsewhere cannot be inspected.
    { code: `log.info('paid', ctx);`, filename: TS },
    { code: `log.info(buildPayload(invoice), 'paid');`, filename: TS },
    { code: `this.logger.warn(context.payload);`, filename: TS },
    { code: `log.info(...args);`, filename: TS },
    // A custom field name.
    {
      code: `log.info({ eventName: 'invoice.paid' }, 'paid');`,
      filename: TS,
      options: [{ eventField: 'eventName' }],
    },
    // Not a logger call.
    { code: `metrics.info({ invoiceId });`, filename: TS },
    { code: `track('paid');`, filename: TS },
    { code: `log.child({ module: 'billing' });`, filename: TS },
    // Outside the configured logger and method sets.
    { code: `console.log('ready');`, filename: TS, options: [{ loggers: ['logger'] }] },
    { code: `log.debug('ready');`, filename: TS, options: [{ methods: ['info', 'warn', 'error'] }] },
  ],
  invalid: [
    // An object payload without the field.
    {
      code: `log.info({ invoiceId }, 'paid');`,
      filename: TS,
      errors: [{ messageId: 'missingEventField', data: { method: 'info', field: 'event' }, column: 10 }],
    },
    {
      code: `this.logger.error('charge failed', { invoiceId, code });`,
      filename: TS,
      errors: [{ messageId: 'missingEventField' }],
    },
    // A nested `event` does not count: the field must be on the payload itself.
    {
      code: `log.info({ meta: { event: 'invoice.paid' } }, 'paid');`,
      filename: TS,
      errors: [{ messageId: 'missingEventField' }],
    },
    // No payload at all.
    {
      code: `log.info('paid');`,
      filename: TS,
      errors: [{ messageId: 'missingPayload', data: { method: 'info', field: 'event' } }],
    },
    {
      code: 'console.warn(`retrying`, 3);',
      filename: TS,
      errors: [{ messageId: 'missingPayload' }],
    },
    { code: `log.info();`, filename: TS, errors: [{ messageId: 'missingPayload' }] },
    // The default field name does not satisfy a custom one.
    {
      code: `log.info({ event: 'invoice.paid' }, 'paid');`,
      filename: TS,
      options: [{ eventField: 'eventName' }],
      errors: [{ messageId: 'missingEventField', data: { method: 'info', field: 'eventName' } }],
    },
    // A custom logger name.
    {
      code: `audit.info({ invoiceId });`,
      filename: TS,
      options: [{ loggers: ['audit'] }],
      errors: [{ messageId: 'missingEventField' }],
    },
  ],
});
