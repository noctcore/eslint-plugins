import { ruleTester } from '@noctcore/eslint-test-utils';

import { noSensitiveFieldsInLogsRule } from '../../src/rules/no-sensitive-fields-in-logs';

const TS = 'service.ts';

ruleTester.run('no-sensitive-fields-in-logs', noSensitiveFieldsInLogsRule, {
  valid: [
    // A string LITERAL mentioning a sensitive word is fine — only names match.
    { code: `logger.info('password reset sent');`, filename: TS },
    // No sensitive names present.
    { code: `logger.info('logged in', { userId });`, filename: TS },
    // `tokenizer` merely contains `token`; segment matching does not flag it.
    { code: `logger.info('parsed', { tokenizer });`, filename: TS },
    // Not a logger call.
    { code: `save({ password });`, filename: TS },
  ],
  invalid: [
    // Object shorthand carrying a denied name.
    {
      code: `logger.info('login', { password });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A camelCase key whose segment matches (`userPassword` → `password`).
    {
      code: `logger.error('auth', { userPassword: p });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A member-access property name (`user.token`).
    {
      code: `logger.info('session', user.token);`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A multi-word denyName matches the compacted name (`apiKey`).
    {
      code: `logger.debug('call', { apiKey });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A configured denylist.
    {
      code: `logger.info('x', { pin });`,
      filename: TS,
      options: [{ denyNames: ['pin'] }],
      errors: [{ messageId: 'sensitiveField' }],
    },
  ],
});
