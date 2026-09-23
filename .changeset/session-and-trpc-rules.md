---
'@noctcore/lint-meta-rules': minor
---

Five rules on two new entry points, promoted from a production NestJS app and parameterised so any project can configure them. None is in `RULE_FACTORIES`, and each is inert until you pass the project's own names, so `createAllRules()` is unchanged and no existing consumer sees a new violation.

`@noctcore/lint-meta-rules/session` fences the seam that mints a session:

- `createSessionMintCallersRule` reports a call to the minting method (`mintCall`) from any file outside `allowedCallers`, so a new sign-in entry point cannot skip the gate in front of the mint.
- `createSessionKindStampedRule` reports a mint whose options literal never mentions the principal kind (`field`, default `kind`), or a mint with delegated options in a file that never mentions it, unless the file is in `allowUnstamped`.
- `createSessionEpochCapturedRule` reports a call into the sign-in seam (`call`) whose arguments never mention the revocation epoch (`field`, default `epoch`). Calls are found by balancing parentheses, so a one-line call is checked too.
- `createSessionLandingDeclaredRule` reports a file that calls a door method (`doorCalls`) without a declared landing in `doors`, a door whose landing demands a return shape it lacks, a door with an unknown landing or an empty reason, and a declared door that no longer exists.

`@noctcore/lint-meta-rules/trpc` adds `createIdempotencyKeyParityRule`, which reports a procedure guarded by an idempotency middleware whose client callers never send the key. The decorator and client shapes default to `nestjs-trpc` and a `trpc.<alias>.<method>` proxy, and are options.

Every rule reads only `sourceGlobs` (or `routerGlobs` and `clientGlobs`), and skips a glob match that is a directory rather than failing on it.
