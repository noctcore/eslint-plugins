# `noctcore-contracts/require-registered-keys`

> The key/name argument of a configured sink API must be an imported constant, not a raw string.

## Why

String keys threaded into sink APIs — storage slots, event channels, feature flags, query-cache keys
— are a classic drift hazard. One call spells the key `'user-profile'`, another `'userProfile'`, and
the two silently never meet: a write lands in one slot, a read misses it. Funnelling every key through
an imported constant from a single registry module makes the key a shared fact, and a typo becomes a
compile error instead of a runtime miss.

## What it flags

A **raw string literal** in the configured key position of a configured sink call:

```ts
// with sinks: [{ callee: 'localStorage.getItem', argIndex: 0 }, { callee: 'emitter.on', argIndex: 0 }]

// ✗
localStorage.getItem('user-profile');
emitter.on('task-done', handler);

// ✓  imported constant
import { USER_PROFILE_KEY, TASK_DONE } from '@/keys';
localStorage.getItem(USER_PROFILE_KEY);
emitter.on(TASK_DONE, handler);
```

Only string literals are flagged. An already-imported identifier, a template literal, or any computed
expression is left alone — those are not the raw-string smell.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sinks` | `{ callee: string, argIndex: number }[]` | `[]` | Callees (dotted paths) and the zero-based argument index to police. |
| `registry` | `string` | — | Optional module the constants should be imported from; named in the report. |

**Inert until configured.** With `sinks` empty the rule reports nothing — there is no universal set of
key sinks to hard-code, so you declare which callees matter for your project.

```js
'noctcore-contracts/require-registered-keys': ['error', {
  sinks: [
    { callee: 'localStorage.getItem', argIndex: 0 },
    { callee: 'localStorage.setItem', argIndex: 0 },
    { callee: 'emitter.on', argIndex: 0 },
    { callee: 'queryClient.getQueryData', argIndex: 0 },
  ],
  registry: '@/keys',
}]
```

`callee` is matched against the call's dotted identifier path (`localStorage.getItem`, `emitter.on`).
A callee that is computed or not a plain identifier chain (`this.emitter.on`, `obj[k].on`, `a().b`)
cannot be matched and is skipped.

## When not to use it

If your keys are already constants, or you have no registry module to import from, leave `sinks` empty
(the rule stays inert) or the rule off.
