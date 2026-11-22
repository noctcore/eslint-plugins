import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { typedEventNamesRule } from '../../src/rules/typed-event-names';

// Absolute paths, so module resolution is independent of the working directory.
const TUPLE = fileURLToPath(new URL('../fixtures/events/tuple.ts', import.meta.url));
const OBJECT = fileURLToPath(new URL('../fixtures/events/object.ts', import.meta.url));
const UNREADABLE = fileURLToPath(new URL('../fixtures/events/unreadable.ts', import.meta.url));
// A linted file beside the fixtures, for resolution against the linted file.
const BESIDE = fileURLToPath(new URL('../fixtures/events/service.ts', import.meta.url));

const TS = 'service.ts';
const tuple = [{ eventNamesModule: TUPLE }];
const object = [{ eventNamesModule: OBJECT }];

ruleTester.run('typed-event-names', typedEventNamesRule, {
  valid: [
    // A declared name, as a string literal or an expression-free template.
    { code: `log.info({ event: 'invoice.paid' }, 'paid');`, filename: TS, options: tuple },
    { code: 'logger.info(`paid`, { event: `invoice.paid` });', filename: TS, options: tuple },
    // A template-literal entry in the tuple counts.
    { code: `log.info({ event: 'user.signed-in' });`, filename: TS, options: tuple },
    // `as const` on the value is unwrapped.
    { code: `log.info({ event: 'invoice.failed' as const });`, filename: TS, options: tuple },
    // Both branches of a conditional are declared.
    {
      code: `log.info({ event: ok ? 'invoice.paid' : 'invoice.failed' });`,
      filename: TS,
      options: tuple,
    },
    // An index into the tuple that exists.
    { code: `log.info({ event: LOG_EVENTS[1] });`, filename: TS, options: tuple },
    // Object form: the values are the names, and entries may be used by path.
    { code: `log.info({ event: 'invoice.paid' });`, filename: TS, options: object },
    { code: `log.info({ event: LOG_EVENTS.invoice.paid });`, filename: TS, options: object },
    { code: `log.info({ event: LOG_EVENTS['signIn'] });`, filename: TS, options: object },
    // `Object.freeze` and a custom export name.
    {
      code: `log.info({ event: FROZEN_EVENTS.shipped });`,
      filename: TS,
      options: [{ eventNamesModule: OBJECT, eventNamesExport: 'FROZEN_EVENTS' }],
    },
    // Resolution against the linted file, without the extension.
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: BESIDE,
      options: [{ eventNamesModule: './tuple' }],
    },
    // No event field: that is require-event-field's job.
    { code: `log.info({ invoiceId }, 'paid');`, filename: TS, options: tuple },
    { code: `log.info('paid');`, filename: TS, options: tuple },
    // A spread payload is not inspected.
    { code: `log.info({ ...ctx });`, filename: TS, options: tuple },
    // A custom field name: `event` is then an ordinary key.
    {
      code: `log.info({ event: name, eventName: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: TUPLE, eventField: 'eventName' }],
    },
    // Not a logger call, so nothing is checked and no module is read.
    { code: `track({ event: 'anything' });`, filename: TS },
    { code: `metrics.info({ event: name });`, filename: TS, options: tuple },
    // No event field anywhere: an unset module is not reported.
    { code: `log.info({ invoiceId });`, filename: TS },
  ],
  invalid: [
    // An unknown name, with a hint at the near miss.
    {
      code: `log.info({ event: 'invoice.payed' }, 'paid');`,
      filename: TS,
      options: tuple,
      errors: [
        {
          messageId: 'unknownEvent',
          data: { name: 'invoice.payed', exportName: 'LOG_EVENTS', module: TUPLE, hint: ' Did you mean `invoice.paid`?' },
        },
      ],
    },
    {
      code: `log.info({ event: 'order.created' });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'unknownEvent', data: { name: 'order.created', exportName: 'LOG_EVENTS', module: TUPLE, hint: '' } }],
    },
    // A string-literal key is checked like an identifier key.
    {
      code: `log.info({ 'event': 'invoice.refunded' });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'unknownEvent' }],
    },
    // In the object form, a key is not a name.
    {
      code: `log.info({ event: 'signIn' });`,
      filename: TS,
      options: object,
      errors: [{ messageId: 'unknownEvent' }],
    },
    // A non-literal value cannot be checked.
    {
      code: `log.info({ event: name });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'nonLiteralEvent', data: { field: 'event', exportName: 'LOG_EVENTS' } }],
    },
    {
      code: 'log.info({ event: `invoice.${status}` });',
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'nonLiteralEvent' }],
    },
    {
      code: `log.info({ event: eventFor(invoice) });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'nonLiteralEvent' }],
    },
    // One branch of a conditional is unknown.
    {
      code: `log.info({ event: ok ? 'invoice.paid' : 'invoice.lost' });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'unknownEvent', data: { name: 'invoice.lost', exportName: 'LOG_EVENTS', module: TUPLE, hint: '' } }],
    },
    // A missing entry, and a path that stops on a group of names.
    {
      code: `log.info({ event: LOG_EVENTS.invoice.payed });`,
      filename: TS,
      options: object,
      errors: [{ messageId: 'unknownEntry', data: { text: 'LOG_EVENTS.invoice.payed', exportName: 'LOG_EVENTS', module: OBJECT } }],
    },
    {
      code: `log.info({ event: LOG_EVENTS[7] });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'unknownEntry' }],
    },
    {
      code: `log.info({ event: LOG_EVENTS.invoice });`,
      filename: TS,
      options: object,
      errors: [{ messageId: 'nonLiteralEvent' }],
    },
    // Every object-literal argument is checked.
    {
      code: `log.info({ event: 'nope' }, 'msg', { event: 'nada' });`,
      filename: TS,
      options: tuple,
      errors: [{ messageId: 'unknownEvent' }, { messageId: 'unknownEvent' }],
    },
    // Configuration errors are reported once per file, on the first event field.
    {
      code: `log.info({ event: 'invoice.paid' }); log.warn({ event: 'invoice.failed' });`,
      filename: TS,
      errors: [{ messageId: 'configError', data: { reason: '`eventNamesModule` is not set' }, column: 12 }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: 'does/not/exist.ts' }],
      errors: [{ messageId: 'configError', data: { reason: '`does/not/exist.ts` was not found' } }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: TUPLE, eventNamesExport: 'EVENTS' }],
      errors: [{ messageId: 'configError', data: { reason: 'it has no top-level exported `EVENTS`' } }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: UNREADABLE, eventNamesExport: 'SPREAD_EVENTS' }],
      errors: [
        {
          messageId: 'configError',
          data: { reason: '`SPREAD_EVENTS` cannot be read statically: an array element is a spread or a hole' },
        },
      ],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: UNREADABLE, eventNamesExport: 'MUTABLE_EVENTS' }],
      errors: [{ messageId: 'configError', data: { reason: '`MUTABLE_EVENTS` is not declared with `const`' } }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: UNREADABLE, eventNamesExport: 'BUILT_EVENTS' }],
      errors: [{ messageId: 'configError' }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: UNREADABLE, eventNamesExport: 'EMPTY_EVENTS' }],
      errors: [{ messageId: 'configError', data: { reason: '`EMPTY_EVENTS` declares no event names' } }],
    },
    {
      code: `log.info({ event: 'invoice.paid' });`,
      filename: TS,
      options: [{ eventNamesModule: UNREADABLE, eventNamesExport: 'SINGLE_EVENT' }],
      errors: [{ messageId: 'configError', data: { reason: '`SINGLE_EVENT` must be an array or an object of strings' } }],
    },
  ],
});
