# `session-landing-declared`

> Every file that opens a door into a session declares where it leaves the caller, and a door whose
> landing demands a return shape has it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createSessionLandingDeclaredRule` from `@noctcore/lint-meta-rules/session` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `session` entry point:

```ts
import { createSessionLandingDeclaredRule } from '@noctcore/lint-meta-rules/session';
```

## Why

With two shells behind one sign-in (staff and a customer portal, say), the client can only send an
account to the right one if the response that ends the sign-in says which kind it is. The first door
(the password sign-in) usually does. A second door that finishes a sign-in from a different service (a
second-factor challenge) can return the same union and still have its landing unwired, and nothing
fails: the account signs in, lands in the wrong shell, and bounces off its guard. In one production
codebase, every portal account with 2FA enabled did exactly that.

Two sibling rules fence the same seam, [`session-mint-callers`](./session-mint-callers.md) (who may
mint) and [`session-kind-stamped`](./session-kind-stamped.md) (the session carries the kind). Neither
can see this, because both are about the session and this is about the RESPONSE.

## What it flags

1. **Completeness.** A file matched by `sourceGlobs` that calls any of `doorCalls` and is not in
   `doors`. A new door fails the build until someone classifies it, which is what keeps the list an
   enumeration rather than a docblock nobody updates.
2. **The landing's demand.** A door whose landing maps to a string in `landings` and whose source never
   contains that string (for example `Promise<ILoginResult>`, the return type that carries the kind to
   the client). Coarse on purpose: it proves the kind REACHES the client, which is what a text rule can
   see; where the client then navigates is the client's own tests' job.
3. **The declarations.** A door whose `landing` is not a key of `landings`, or whose `because` is empty.
4. **Staleness.** A door whose file no longer exists, or that `sourceGlobs` do not reach.

## What it does not flag

- A file that only defines a door method (the leading dot is required).
- A door whose landing maps to `null`: a re-issue that replaces the cookie of a caller already inside a
  shell has no landing to get wrong.
- Files ending in an `excludeSuffixes` entry, and `skipDirs` segments.

With no `doorCalls` the rule is inert.

## Options

```ts
createSessionLandingDeclaredRule(options?: SessionLandingDeclaredOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'session-landing-declared'` | Rule id. |
| `doorCalls` | `string[]` | `[]` (inert) | Methods whose call opens a door into a session (the mint, and the gate in front of it), each matched as `.<name>(`. |
| `doors` | `{ file, landing, because }[]` | `[]` | Every door: a repo-relative file, one of the `landings`, and why that landing is right. |
| `landings` | `Record<string, string \| null>` | `{}` | The landings a door may declare, each mapped to the text a door with it must contain, or `null`. |
| `sourceGlobs` | `string[]` | `[]` (inert) | Application source to read. |
| `skipDirs` | `string[]` | `node_modules`, `.git`, `dist`, `.turbo`, `coverage` | Path segments skipped. |
| `excludeSuffixes` | `string[]` | `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` | File endings skipped. |
| `hint` | `string` | none | Appended to every message. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

### Worked example: an app with two sign-in shells

Staff and portal accounts share one sign-in and land in different shells. Sessions open through
`establishSession` or the second-factor gate `beginOrEstablish`. The two doors either kind can reach
must return `Promise<ILoginResult>`; the rest are staff-only or re-issues:

```ts
const AUTH = 'apps/api/src/modules/auth';

createSessionLandingDeclaredRule({
  doorCalls: ['establishSession', 'beginOrEstablish'],
  landings: { 'login-result': 'Promise<ILoginResult>', reissue: null, 'staff-only': null },
  doors: [
    { file: `${AUTH}/services/login.service.ts`, landing: 'login-result', because: 'The password sign-in: either half of the product arrives here.' },
    { file: `${AUTH}/services/two-factor-challenge.service.ts`, landing: 'login-result', because: 'The second door: verifyChallenge finishes a sign-in on its own.' },
    { file: `${AUTH}/oauth/oauth.controller.ts`, landing: 'staff-only', because: 'OAuthAccountService refuses a PORTAL account on every resolution branch.' },
    { file: `${AUTH}/services/register.service.ts`, landing: 'staff-only', because: 'Self-signup mints a tenant and its owner ADMIN.' },
    { file: `${AUTH}/services/password-change.service.ts`, landing: 'reissue', because: 'The caller already holds a session.' },
    { file: `${AUTH}/services/session-management.service.ts`, landing: 'reissue', because: 'revokeOthers re-issues the caller their own session.' },
  ],
  sourceGlobs: ['apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}'],
});
```

## When not to use it

With a single shell, or with the landing decided server-side by a redirect that already reads the
account, there is no landing a door can get wrong.
