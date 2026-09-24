# `session-kind-stamped`

> Every call that mints a session stamps the principal's kind onto it, or sits in an allowlisted,
> provably single-kind flow.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createSessionKindStampedRule` from `@noctcore/lint-meta-rules/session` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `session` entry point:

```ts
import { createSessionKindStampedRule } from '@noctcore/lint-meta-rules/session';
```

## Why

When one sign-in serves two kinds of account (staff and a customer portal, say) and the request
pipeline reads the kind from the SESSION rather than the database, the stamp is only as good as the
mint that wrote it. A session minted without the field reads as whatever the reader defaults to. For the
fence between the two kinds that is a silent promotion: a portal account whose session lost its stamp
is a staff caller inside its own tenant, and the tenant boundary waves it through as legitimate.

This is not hypothetical. In the project this rule was extracted from, two re-issue paths (a password
change and a revoke-other-sessions action, both reachable by a portal account) shipped without the
stamp while every gate was green, because nothing mechanical looked.

## What it flags

For each `.<mintCall>(...)` call in a file matched by `sourceGlobs` (arguments found by balancing
parentheses, so a multi-line options object with nested calls is read whole):

1. If the arguments contain an object literal, that literal must mention `field` as a whole word. Each
   call is checked on its own, so a file with two mints where only one stamps is still reported.
2. If the arguments carry no literal (options built elsewhere), the file must mention `field`
   somewhere. Coarser, but no silent hole.
3. Otherwise the file must be in `allowUnstamped`.

Residual gap, stated rather than hidden: a file that stamps the field on one delegated mint and forgets
it on a second delegated mint passes clause 2.

## What it leaves alone

- `.<mintCall>Something(`, and the method's definition.
- `kindless` or `kinds`: the field must appear as a whole word.
- Files in `allowUnstamped`, files ending in an `excludeSuffixes` entry, and `skipDirs` segments.

With no `mintCall` the rule is inert.

## Factory

```ts
createSessionKindStampedRule(options?: SessionKindStampedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'session-kind-stamped'` | Rule id. |
| `mintCall` | `string` | none (inert) | The method whose call mints a session, matched as `.<mintCall>(`. |
| `field` | `string` | `'kind'` | The session field every mint must stamp. |
| `allowUnstamped` | `string[]` | `[]` | Repo-relative files whose mints may stamp nothing because they provably never mint for an account that needs the field. Keep it short; write the proof next to each entry. |
| `stampExample` | `string` | none | An example of the stamp, quoted in the message. |
| `sourceGlobs` | `string[]` | `[]` (inert) | Application source to read. |
| `skipDirs` | `string[]` | `node_modules`, `.git`, `dist`, `.turbo`, `coverage` | Path segments skipped. |
| `excludeSuffixes` | `string[]` | `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` | File endings skipped. |
| `hint` | `string` | none | Appended to every message. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Worked example: Settly

```ts
createSessionKindStampedRule({
  mintCall: 'establishSession',
  // Self-signup creates a new tenant and its owner ADMIN; a PORTAL row is only ever
  // invite-provisioned, so no input to this flow produces a portal session.
  allowUnstamped: ['apps/api/src/modules/auth/services/register.service.ts'],
  stampExample: "...(user.kind === 'PORTAL' ? { kind: 'PORTAL' as const } : {})",
  sourceGlobs: ['apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}'],
});
```

## When not to use it

If the pipeline reads the account kind from the database on every request, a missing stamp costs
nothing and there is nothing to fence.
