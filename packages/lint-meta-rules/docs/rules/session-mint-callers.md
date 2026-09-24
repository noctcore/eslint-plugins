# `session-mint-callers`

> The method that mints a session is callable only from an allowlist of files, so a new sign-in
> entry point cannot skip the gate in front of it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createSessionMintCallersRule` from `@noctcore/lint-meta-rules/session` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `session` entry point:

```ts
import { createSessionMintCallersRule } from '@noctcore/lint-meta-rules/session';
```

## Why

Most auth stacks have one method that turns an authenticated principal into a session: it writes the
session store, sets the cookie, rotates CSRF. In front of it sits a gate (a second-factor challenge, an
epoch capture) that every sign-in is meant to pass through. A new entry point, typically an OAuth
callback added months later, that calls the mint directly signs the user in with the gate skipped, and
nothing fails: the flow works, its tests pass, the gate's tests pass. The mint is the one door into a
session, so this rule fences the door by caller.

## What it flags

A file matched by `sourceGlobs` that calls `.<mintCall>(` (whitespace before the paren allowed) and is
not in `allowedCallers`.

## What it leaves alone

- The method's definition (`async establishSession(`): the leading dot is required.
- `.<mintCall>Something(`: only whitespace may sit between the name and the paren.
- Files ending in an `excludeSuffixes` entry (tests drive the mint directly), and paths with a
  `skipDirs` segment.
- Everything outside `sourceGlobs`, including a lint-meta rule module that quotes the call.

With no `mintCall` the rule is inert.

## Factory

```ts
createSessionMintCallersRule(options?: SessionMintCallersOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'session-mint-callers'` | Rule id. |
| `mintCall` | `string` | none (inert) | The method whose call mints a session, matched as `.<mintCall>(`. |
| `allowedCallers` | `string[]` | `[]` | Repo-relative files that may call it, matched exactly: the method's home, the gate, and flows with no gate to pass (signup, a re-issue to a caller who already holds a session). |
| `gateCall` | `string` | none | The method a sign-in entry point must call instead, named in the message. |
| `sourceGlobs` | `string[]` | `[]` (inert) | Application source to read. |
| `skipDirs` | `string[]` | `node_modules`, `.git`, `dist`, `.turbo`, `coverage` | Path segments skipped. |
| `excludeSuffixes` | `string[]` | `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` | File endings skipped. |
| `hint` | `string` | none | Appended to every message, e.g. a pointer to your auth docs. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Worked example: Settly

```ts
const AUTH = 'apps/api/src/modules/auth/services';

createSessionMintCallersRule({
  id: 'establish-session-callers',
  mintCall: 'establishSession',
  gateCall: 'beginOrEstablish',
  allowedCallers: [
    `${AUTH}/auth-shared.service.ts`,
    `${AUTH}/two-factor-challenge.service.ts`,
    `${AUTH}/register.service.ts`,
    `${AUTH}/password-change.service.ts`,
    `${AUTH}/session-management.service.ts`,
  ],
  sourceGlobs: ['apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}'],
});
```

## When not to use it

If sessions are minted by a framework you do not call (a hosted auth provider's middleware), there is no
method to fence.
