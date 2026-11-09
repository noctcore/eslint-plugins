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
    // The advised fix: a redactor call is a boundary, and its key is not reported.
    { code: `logger.info('login', { token: redact(token) });`, filename: TS },
    { code: `logger.info('login', { password: mask(user.password) });`, filename: TS },
    { code: `logger.info('login', redact(token));`, filename: TS },
    { code: `logger.info('login', { token: this.redactor.redact(token) });`, filename: TS },
    // A configured redactor.
    {
      code: `logger.info('login', { token: scrub(token) });`,
      filename: TS,
      options: [{ redactors: ['scrub'] }],
    },
    // Flags, counts and timestamps about a secret are not the secret.
    { code: `logger.info('stats', { tokenCount, hasPassword, cookieConsent });`, filename: TS },
    { code: `logger.info('stats', { isTokenValid, passwordLength, tokenExpiresAt });`, filename: TS },
    // An explicit allow list.
    {
      code: `logger.info('x', { csrfToken });`,
      filename: TS,
      options: [{ allowNames: ['csrfToken'] }],
    },
    // A method outside a narrowed set.
    {
      code: `logger.trace({ secret });`,
      filename: TS,
      options: [{ methods: ['info', 'warn', 'error'] }],
    },
    // A logger name outside a narrowed set.
    {
      code: `console.log(password);`,
      filename: TS,
      options: [{ loggers: ['logger'] }],
    },
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
    // Common sinks outside info / warn / error / debug.
    {
      code: `console.log(password);`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    {
      code: `this.logger.log('x', { password });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    {
      code: `logger.fatal({ token });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    {
      code: `logger.trace({ secret });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    {
      code: `this.logger.verbose('x', { apiKey });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A configured logger name (the option was ignored before).
    {
      code: `pino.info({ password });`,
      filename: TS,
      options: [{ loggers: ['pino'] }],
      errors: [{ messageId: 'sensitiveField' }],
    },
    // A non-redactor call still exposes its argument.
    {
      code: `logger.info('login', { token: String(token) });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }, { messageId: 'sensitiveField' }],
    },
    // A bare secret name is not metadata.
    {
      code: `logger.info('x', { accessToken, refresh_token: t });`,
      filename: TS,
      errors: [{ messageId: 'sensitiveField' }, { messageId: 'sensitiveField' }],
    },
  ],
});
