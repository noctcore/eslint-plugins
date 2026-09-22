---
'@noctcore/eslint-plugin-security': minor
---

New rule `server-action-through-client`, shipped off and left out of `recommended`.

In a module whose first statement is `'use server'`, every exported action must be built
from an action client named in `actionClients` (`actionClient.inputSchema(...).action(...)`,
`createServerFn().middleware([...]).handler(...)`), and no raw `export async function` may
appear. A raw exported function is a public POST endpoint with no input schema, no error
policy and no middleware, so no auth middleware either. The rule does not decide which client
is right: a public form built from an unauthenticated client is correct code, and the client's
name at the definition site is where a reviewer reads that choice.

Inline actions (`async function x() { 'use server'; ... }` in a component body) cannot go
through a client and are reported unless `allowInline` is set. Non-function exports, re-exports
and modules without the directive are left alone. With an empty `actionClients` the rule accepts
no client and reports every exported action, so enabling it without configuration is loud, not
silent.

No consumer's build changes: the rule is opt-in and needs per-project client names.
