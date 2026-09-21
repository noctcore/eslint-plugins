# `noctcore-observability/audit-pii-declared`

> A PII-shaped key written into an audit payload must be declared: registered for scrubbing when its
> subject is purged, or declared not to be personal data.

## What this rule does and does not prove

Read this section before enabling the rule.

It **enforces declaration, not deletion.** It proves that every PII-shaped key an audit write puts
into a payload it can read appears in a list you maintain. It does **not** prove:

- that anything reads that list, or that your purge job runs, succeeds, or scrubs those keys;
- that a registered value is actually personal data, or that a `nonPiiFields` entry is not;
- anything about payloads it cannot read (see `reportOpaque`) or keys its name heuristic does not
  recognise as PII (a `note` holding an email address passes);
- anything about audit columns outside the payload keys (`ipAddress`, `userAgent`), or about audit
  rows written by code that does not go through `auditCallees`.

The rule is one half of a contract. The other half is a purge job that anonymizes the registered keys
in the audit rows of a user it deletes, and a test of that job. Without that half, this rule is a
list with no reader.

## Why

Audit rows outlive the request that wrote them, and usually outlive the user. A policy of "raw email
stays in audit metadata while the user exists and is scrubbed when the user is purged" keeps the trail
useful for who-did-what while the data does not outlive the person. The purge job can only scrub keys
it knows about. This rule keeps that list complete as new audit writes are added: a new
`metadata: { newEmail }` fails lint until someone decides whether `newEmail` goes in the registry.

## What it flags

An audit write is a call whose callee text is an `auditCallees` entry, or ends with `.<entry>`
(`this.auditService.log` matches `auditService.log`). The rule reads the first argument's
`payloadKeys` properties (`metadata`, `before`, `after` by default). In a payload object literal, at
any depth, including nested objects, array elements and literal spreads, it reports:

- **`undeclaredPiiKey`**: a key matching `piiFields` that is in neither `registeredFields` nor
  `nonPiiFields`;
- **`undeclaredPiiValue`**: an undeclared, neutral key whose value is an identifier or member access
  named like PII (`target: user.email`). The key is what the purger would have to scrub, so the key
  is what must be declared;
- **`opaquePayload`**: a payload the rule cannot read: a payload or params that is not an object
  literal, a spread of a non-literal (`...subject.fence`, `...(extra ?? {})`), or a computed key. A
  bag the rule cannot see is a bag it cannot vouch for. Turn this off with `reportOpaque: false` if
  you accept that gap.

A spread the rule *can* read is not opaque: `...{ a }`, both branches of `...(ok ? { a } : {})`, the
right side of `...(ok && { a })`, and `null` / `undefined`.

### Name matching

`piiFields` entries match like `no-sensitive-fields-in-logs`: a single-word entry (`email`) matches a
camelCase or snake_case segment (`newEmail`, `previous_email`) but not a word that merely contains it;
a multi-word entry (`firstName`) matches the compacted name (`contactFirstName`).

Some PII-shaped names describe the data rather than hold it. A name whose first segment is in
`nonPiiPrefixes` (`isEmailPublic`) or whose last segment is in `nonPiiSuffixes` (`emailSent`,
`phoneVerified`, `addressId`) is not reported. A key whose value is a boolean, number or `null`
literal is not reported either. A name equal to a `piiFields` entry (`nationalId`) is always PII,
whatever its suffix.

Bare `name` is not in the default list, because it would flag `fileName` and `templateName`. Add it
if your audit payloads carry person names under that key.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `auditCallees` | `string[]` | `[]` | Callee texts that are audit writes. Empty means the rule is inert. |
| `payloadKeys` | `string[]` | `['metadata', 'before', 'after']` | Properties of the audit call's params that hold free-form payload. |
| `piiFields` | `string[]` | `email`, `phone`, `mobile`, `address`, `firstName`, `lastName`, `fullName`, `displayName`, `surname`, `birthDate`, `dateOfBirth` | Name patterns that are PII-shaped. |
| `registeredFields` | `string[]` | `[]` | Exact keys the purger scrubs. Declared PII. |
| `nonPiiFields` | `string[]` | `[]` | Exact keys declared not to be personal data. |
| `nonPiiPrefixes` | `string[]` | `is`, `has`, `was`, `should`, `can` | A first name segment that marks a flag. |
| `nonPiiSuffixes` | `string[]` | `sent`, `verified`, `confirmed`, `enabled`, `disabled`, `changed`, `required`, `count`, `type`, `kind`, `status`, `id`, `ids` | A last name segment that marks a flag, count or reference. |
| `reportOpaque` | `boolean` | `true` | Report payloads the rule cannot read. |

## Wiring: one registry, not two

The purge job needs the registry at run time and this rule needs it at lint time. Keep **one** copy,
in code both can import, and pass it into the ESLint config. Never retype it into the config: two
hand-kept copies of one list drift.

```ts
// packages/shared/src/audit/pii-registry.ts
/** Audit payload keys holding personal data. The user purge anonymizes these. */
export const AUDIT_PII_FIELDS = ['newEmail', 'email'] as const;
```

```js
// eslint.config.mjs
import { AUDIT_PII_FIELDS } from '@acme/shared/audit/pii-registry';

export default [
  {
    rules: {
      'noctcore-observability/audit-pii-declared': [
        'error',
        {
          auditCallees: ['auditService.log', 'auditService.logOrThrow'],
          registeredFields: [...AUDIT_PII_FIELDS],
          nonPiiFields: ['emailTemplate'],
        },
      ],
    },
  },
];
```

## Examples

```ts
// Bad: raw email in the payload, and no declaration that the purger must scrub it
await this.auditService.log({
  action: 'auth.email_change.requested',
  userId,
  metadata: { newEmail: normalizedEmail },
});

// Bad: before/after snapshots of a PII column
await this.auditService.log({
  action: 'auth.email_changed',
  before: { email: previousEmail },
  after: { email: pending.newEmail },
});

// Bad: the rule cannot see what this bag carries
await this.auditService.log({ action, metadata: { ...grant.auditMetadata } });

// Good, with registeredFields: ['newEmail', 'email']
await this.auditService.log({ action, userId, metadata: { newEmail: normalizedEmail } });

// Good: nothing PII-shaped; `emailSent` is a flag about the data
await this.auditService.log({ action, metadata: { role, outcome, emailSent } });
```

## When not to use it

If your audit payloads never carry personal data by policy, `no-sensitive-fields-in-logs`-style
denial (fail on any PII-shaped key) is simpler: set `registeredFields` to `[]` and treat every report
as a key to remove. If you have no purge job, do not enable this rule as if it gave you one.
