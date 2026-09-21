import { ruleTester } from '@noctcore/eslint-test-utils';

import { auditPiiDeclaredRule } from '../../src/rules/audit-pii-declared';

const AUDIT = { auditCallees: ['auditService.log', 'auditService.logOrThrow'] };
const opts = (extra: Record<string, unknown> = {}) => [{ ...AUDIT, ...extra }];

ruleTester.run('audit-pii-declared', auditPiiDeclaredRule, {
  valid: [
    // Default config names no audit callee: the rule is inert.
    { code: `this.auditService.log({ action, metadata: { newEmail } });` },
    // Non-PII payload keys.
    {
      code: `this.auditService.log({ action, metadata: { role, outcome, provider: identity.provider } });`,
      options: opts(),
    },
    // A registered key is declared: the purger scrubs it.
    {
      code: `this.auditService.log({ action, metadata: { newEmail: normalizedEmail } });`,
      options: opts({ registeredFields: ['newEmail'] }),
    },
    {
      code: `await this.auditService.log({ before: { email: prev }, after: { email: next } });`,
      options: opts({ registeredFields: ['email'] }),
    },
    // A key declared not to be personal data.
    {
      code: `this.auditService.log({ metadata: { emailTemplate: 'welcome' } });`,
      options: opts({ nonPiiFields: ['emailTemplate'] }),
    },
    // Flags, counts and references ABOUT the data are not the data.
    { code: `this.auditService.log({ metadata: { emailSent } });`, options: opts() },
    { code: `this.auditService.log({ metadata: { phoneVerified: ok } });`, options: opts() },
    { code: `this.auditService.log({ metadata: { addressId: a.id } });`, options: opts() },
    { code: `this.auditService.log({ metadata: { isEmailPublic } });`, options: opts() },
    // A boolean or number literal holds no personal data whatever its key.
    { code: `this.auditService.log({ metadata: { email: true } });`, options: opts() },
    // PII-shaped keys outside the payload keys are not payload.
    { code: `this.auditService.log({ action, ipAddress: ip, userAgent });`, options: opts() },
    // A conditional spread of literals is read, not treated as opaque.
    {
      code: `this.auditService.log({ ...(id === null ? {} : { targetType: 'User', targetId: id }), metadata: { reason } });`,
      options: opts(),
    },
    {
      code: `this.auditService.log({ metadata: { provider, ...(sub === undefined ? {} : { providerAccountId: sub }) } });`,
      options: opts(),
    },
    // A null payload is empty, not opaque.
    { code: `this.auditService.log({ action, metadata: null });`, options: opts() },
    // Opaque payloads pass when reportOpaque is off.
    {
      code: `this.auditService.log({ action, metadata });`,
      options: opts({ reportOpaque: false }),
    },
    // A different receiver is not an audit call.
    { code: `this.logger.log({ metadata: { email } });`, options: opts() },
    { code: `myauditService.log({ metadata: { email } });`, options: opts() },
    // Not in the default PII list: bare `name` would flag fileName / templateName.
    { code: `this.auditService.log({ metadata: { fileName, name } });`, options: opts() },
  ],
  invalid: [
    // The motivating sites: raw email in metadata and in before/after snapshots.
    {
      code: `await this.auditService.log({ action, userId, metadata: { newEmail: normalizedEmail } });`,
      options: opts(),
      errors: [{ messageId: 'undeclaredPiiKey', data: { key: 'newEmail', payload: 'metadata' } }],
    },
    {
      code: `await this.auditService.log({ before: { email: previousEmail }, after: { email: pending.newEmail } });`,
      options: opts(),
      errors: [
        { messageId: 'undeclaredPiiKey', data: { key: 'email', payload: 'before' } },
        { messageId: 'undeclaredPiiKey', data: { key: 'email', payload: 'after' } },
      ],
    },
    // logOrThrow and a bare function callee.
    {
      code: `auditService.logOrThrow({ metadata: { phoneNumber } });`,
      options: opts(),
      errors: [
        { messageId: 'undeclaredPiiKey', data: { key: 'phoneNumber', payload: 'metadata' } },
      ],
    },
    {
      code: `audit({ metadata: { home_address: addr } });`,
      options: [{ auditCallees: ['audit'] }],
      errors: [{ messageId: 'undeclaredPiiKey' }],
    },
    // A neutral key holding a PII-named value.
    {
      code: `this.auditService.log({ metadata: { target: user.email } });`,
      options: opts(),
      errors: [
        {
          messageId: 'undeclaredPiiValue',
          data: { key: 'target', payload: 'metadata', value: 'user.email' },
        },
      ],
    },
    // Nested literals and array elements are read.
    {
      code: `this.auditService.log({ after: { contact: { firstName: f }, list: [{ lastName: l }] } });`,
      options: opts(),
      errors: [{ messageId: 'undeclaredPiiKey' }, { messageId: 'undeclaredPiiKey' }],
    },
    // A literal spread inside a payload is read too.
    {
      code: `this.auditService.log({ metadata: { ...(changed && { email: next }) } });`,
      options: opts(),
      errors: [{ messageId: 'undeclaredPiiKey', data: { key: 'email', payload: 'metadata' } }],
    },
    // Opaque payloads cannot be vouched for.
    {
      code: `this.auditService.log({ action, metadata });`,
      options: opts(),
      errors: [
        {
          messageId: 'opaquePayload',
          data: { payload: 'metadata', why: 'it is not an object literal' },
        },
      ],
    },
    {
      code: `this.auditService.log({ metadata: { role, ...subject.fence } });`,
      options: opts(),
      errors: [{ messageId: 'opaquePayload' }],
    },
    {
      code: `this.auditService.log({ metadata: { [field]: value } });`,
      options: opts(),
      errors: [
        { messageId: 'opaquePayload', data: { payload: 'metadata', why: 'it has a computed key' } },
      ],
    },
    {
      code: `this.auditService.log(params);`,
      options: opts(),
      errors: [
        {
          messageId: 'opaquePayload',
          data: { payload: 'params', why: 'the audit call is not given an object literal' },
        },
      ],
    },
    // Configured payload keys and PII fields.
    {
      code: `this.auditService.log({ changes: { ssn } });`,
      options: opts({ payloadKeys: ['changes'], piiFields: ['ssn'] }),
      errors: [{ messageId: 'undeclaredPiiKey', data: { key: 'ssn', payload: 'changes' } }],
    },
    // An exact piiFields entry beats the `id` suffix heuristic.
    {
      code: `this.auditService.log({ metadata: { nationalId, addressId } });`,
      options: opts({ piiFields: ['address', 'nationalId'] }),
      errors: [{ messageId: 'undeclaredPiiKey', data: { key: 'nationalId', payload: 'metadata' } }],
    },
    // The flag heuristic is configurable: with no suffixes, emailSent is PII-shaped again.
    {
      code: `this.auditService.log({ metadata: { emailSent } });`,
      options: opts({ nonPiiSuffixes: [] }),
      errors: [{ messageId: 'undeclaredPiiKey' }],
    },
  ],
});
