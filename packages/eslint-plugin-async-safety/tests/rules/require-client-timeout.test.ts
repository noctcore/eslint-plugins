import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireClientTimeoutRule } from '../../src/rules/require-client-timeout';

const S3 = { callee: 'S3Client', construct: true, requireAnyOf: ['requestHandler'] };
const MAILER = {
  callee: 'nodemailer.createTransport',
  requireAnyOf: ['connectionTimeout', 'socketTimeout'],
};
const clients = [{ clients: [S3, MAILER] }];

ruleTester.run('require-client-timeout', requireClientTimeoutRule, {
  valid: [
    // Default config knows no client: nothing is checked.
    { code: `new S3Client({ region });` },
    { code: `nodemailer.createTransport({ host });` },
    // A required key is present (identifier, shorthand, string key).
    {
      code: `new S3Client({ region, requestHandler: { connectionTimeout: 5000 } });`,
      options: clients,
    },
    { code: `new S3Client({ requestHandler });`, options: clients },
    { code: `nodemailer.createTransport({ host, 'socketTimeout': 1 });`, options: clients },
    // Any one of requireAnyOf suffices.
    { code: `nodemailer.createTransport({ host, connectionTimeout: 1 });`, options: clients },
    // Opaque options bag: may already set a timeout.
    { code: `new S3Client(config);`, options: clients },
    { code: `nodemailer.createTransport(buildSmtpOptions());`, options: clients },
    { code: `nodemailer.createTransport(this.options);`, options: clients },
    // Spread argument, or a spread inside the options literal: opaque.
    { code: `new S3Client(...args);`, options: clients },
    { code: `new S3Client({ ...base, region });`, options: clients },
    // Call vs construct must match the spec.
    { code: `S3Client({ region });`, options: clients },
    { code: `new nodemailer.createTransport({ host });`, options: clients },
    // A different receiver is a different callee.
    { code: `mailer.createTransport({ host });`, options: clients },
    { code: `new aws.S3Client({ region });`, options: clients },
  ],
  invalid: [
    {
      code: `new S3Client({ region: 'eu-central-1' });`,
      options: clients,
      errors: [
        { messageId: 'missingTimeout', data: { callee: 'S3Client', keys: '`requestHandler`' } },
      ],
    },
    // No arguments at all is plainly timeout-free.
    {
      code: `const s3 = new S3Client();`,
      options: clients,
      errors: [{ messageId: 'missingTimeout' }],
    },
    {
      code: `nodemailer.createTransport({ host, port, secure: true });`,
      options: clients,
      errors: [
        {
          messageId: 'missingTimeout',
          data: {
            callee: 'nodemailer.createTransport',
            keys: '`connectionTimeout`, `socketTimeout`',
          },
        },
      ],
    },
    // A connection-URL-only call carries no options.
    {
      code: 'nodemailer.createTransport(`smtp://${host}:587`);',
      options: clients,
      errors: [{ messageId: 'missingTimeout' }],
    },
    // A nested timeout does not count: the key must be top-level.
    {
      code: `new S3Client({ region, config: { requestHandler: h } });`,
      options: clients,
      errors: [{ messageId: 'missingTimeout' }],
    },
    // A plain-call client with a custom key.
    {
      code: `const pool = createPool({ host });`,
      options: [{ clients: [{ callee: 'createPool', requireAnyOf: ['connectTimeout'] }] }],
      errors: [
        { messageId: 'missingTimeout', data: { callee: 'createPool', keys: '`connectTimeout`' } },
      ],
    },
  ],
});
