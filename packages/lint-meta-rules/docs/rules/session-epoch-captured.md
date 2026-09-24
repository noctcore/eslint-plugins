# `session-epoch-captured`

> Every call into the sign-in seam passes the session epoch it captured before reading the
> credential.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createSessionEpochCapturedRule` from `@noctcore/lint-meta-rules/session` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `session` entry point:

```ts
import { createSessionEpochCapturedRule } from '@noctcore/lint-meta-rules/session';
```

## Why

A common way to make "sign out everywhere" stick is a per-user epoch: a revocation bumps it, and a mint
refuses to write a session under a stale value. Where the epoch is read decides what the fence covers.
Read inside the mint, it covers the session-store write and nothing else, so the whole credential check
(a password hash verify, an OAuth token exchange) is a window in which a sign-in that already read the
revoked state still mints a surviving session.

So every entry point reads the epoch BEFORE it reads the credential and hands the value to the seam
that ends the sign-in. Forgetting to is invisible: the sign-in works and every test passes, because the
race only loses under a concurrent revocation. This rule fails any call into the seam whose arguments
never mention the epoch.

## What it flags

Each `.<call>(...)` call in a file matched by `sourceGlobs` whose argument text (found by balancing
parentheses) does not mention `field` as a whole word. The parenthesis scanner reads each call on its
own, so a call written on one line is checked too, and an unstamped call cannot borrow the epoch of
the next one.

## What it does not flag

- `epochless: true`, or any identifier that merely contains the field: whole words only.
- Files in `exempt` (the seam's own home, which defines the method and its default).
- Files ending in an `excludeSuffixes` entry, and `skipDirs` segments.

With no `call` the rule is inert.

## Options

```ts
createSessionEpochCapturedRule(options?: SessionEpochCapturedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'session-epoch-captured'` | Rule id. |
| `call` | `string` | none (inert) | The post-credential seam, matched as `.<call>(`. |
| `field` | `string` | `'epoch'` | The argument every call must mention. |
| `exempt` | `string[]` | `[]` | Repo-relative files skipped outright: the seam's own home. |
| `captureCall` | `string` | none | How the epoch is captured, quoted in the message. |
| `sourceGlobs` | `string[]` | `[]` (inert) | Source to read. |
| `skipDirs` | `string[]` | `node_modules`, `.git`, `dist`, `.turbo`, `coverage` | Path segments skipped. |
| `excludeSuffixes` | `string[]` | `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` | File endings skipped. |
| `hint` | `string` | none | Appended to every message. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

### Worked example: an app with a post-credential sign-in seam

Every sign-in entry point (password, OAuth, second factor) ends by calling one seam,
`beginOrEstablish`, which a two-factor challenge service defines. Each entry point reads the epoch with
`sessionService.readEpoch(userId)` before it checks the credential, and passes it in:

```ts
createSessionEpochCapturedRule({
  call: 'beginOrEstablish',
  exempt: ['apps/api/src/modules/auth/services/two-factor-challenge.service.ts'],
  captureCall: 'sessionService.readEpoch(userId)',
  sourceGlobs: [
    'apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}',
    'packages/*/{src,test,tests,security-spec}/**/*.{ts,tsx}',
    'tools/**/*.{ts,tsx}',
  ],
  excludeSuffixes: ['.spec.ts', '.test.ts'],
});
```

Two flows in such an app mint without a captured epoch and are outside the rule by construction, because they
never call the seam: signup (the account did not exist when the request began) and password change (it
revokes first and then re-issues, so the current counter is the right one).

## When not to use it

Without a revocation epoch (or an equivalent generation counter) there is no fence to extend.
