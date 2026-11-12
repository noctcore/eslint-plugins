# `noctcore-react/max-state-per-hook`

> Cap the `useState` slots one hook keeps and the setters one action calls, so hand-written state machines become reducers.

<!-- begin generated rule header -->
☑️ In `strict` at `error`, not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A screen hook that keeps eight `useState` slots is a state machine written by hand. Every handler
has to set four or five of them in the right order (`setBusy(null)`, `setCode('')`, `setDead(null)`,
`setSaid('sent')`, ...), and one forgotten reset leaves the screen in a combination no branch
expects: a spinner that never stops, an error line under a code that was accepted. Review does not
catch it, because each handler looks reasonable on its own; the defect is in the combinations.

The pieces usually split three ways. Some can be derived during render from the others. Busy flags
are already tracked by the mutation that does the work (`isPending`, `variables`, `reset()`). What
is left belongs in one `useReducer`, whose events name the transitions and can be unit tested
without a DOM.

```ts bad filename=src/auth/CodeStep.hooks.ts reports=2
import { useState } from 'react';

export function useCodeStep() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<'wrong' | 'sent' | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);

  const afterSend = (resendInSeconds: number) => {
    setBusy(false);
    setCode('');
    setDead(null);
    setSaid('sent');
    setResendAt(Date.now() + resendInSeconds * 1000);
  };

  return { code, busy, said, dead, resendAt, afterSend, setCode };
}
```

```ts good filename=src/auth/CodeStep.hooks.ts
import { useReducer } from 'react';
import { codeStep, initialCodeStep } from './code-step';

export function useCodeStep() {
  const [step, dispatch] = useReducer(codeStep, initialCodeStep);
  const afterSend = (resendInSeconds: number) =>
    dispatch({ type: 'sent', resendAt: Date.now() + resendInSeconds * 1000 });
  return { step, afterSend, dispatch };
}
```

## What it flags

Only in hook files: a basename ending with a `hookFileSuffixes` entry (default `.hooks.ts` and
`.hooks.tsx`). Two counts:

- **State per hook.** Every function named `use[A-Z]`, exported or not, may keep at most `max`
  (default **4**) `useState` / `useReducer` slots: calls whose nearest enclosing function is that
  hook. `React.useState`, a namespace import and an aliased import
  (`import { useState as useLocalState } from 'react'`) all count. A `useReducer` counts as one
  slot however wide its state. The report lands on the hook name, once per hook.
- **Setters per action.** Inside any function nested in a hook (a handler, an effect body, a
  `.then` callback), at most `maxSettersPerFunction` (default **3**) distinct `useState` setters
  may be called. A setter called twice counts once, and each function counts on its own, so a
  callback inside a handler has its own budget. The report lands on the function's name, or on the
  first setter past the limit when the function is an inline callback.

```ts bad filename=src/profile/ProfileForm.hooks.ts options={"max":10}
import { useState } from 'react';

export function useProfileForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setEmail('');
    setSaved(false);
    setError(null);
  };

  return { name, email, saved, error, reset };
}
```

```ts good filename=src/profile/ProfileForm.hooks.ts options={"max":10}
import { useReducer } from 'react';
import { initialProfile, profileForm } from './profile-form';

export function useProfileForm() {
  const [form, dispatch] = useReducer(profileForm, initialProfile);
  const reset = () => dispatch({ type: 'reset' });
  return { form, reset };
}
```

### A private sub-hook has its own budget

Splitting a concern into a private `use*` function in the same file is one of the fixes, so a
sub-hook is counted on its own and its slots are not added to the hook that calls it.

```ts good filename=src/auth/CodeStep.hooks.ts
import { useState } from 'react';

function useResendTimer() {
  const [resendAt, setResendAt] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  return { resendAt, blockedUntil, setResendAt, setBlockedUntil };
}

export function useCodeStep() {
  const [code, setCode] = useState('');
  const [said, setSaid] = useState<'wrong' | 'sent' | null>(null);
  const timer = useResendTimer();
  return { code, said, setCode, setSaid, timer };
}
```

## What it does not flag

- `useRef`, `useQuery`, `useMutation`, `useForm`, external stores, and any other hook: only
  `useState` and `useReducer` are state slots here.
- A frozen snapshot, `const [startedAt] = useState(() => Date.now())`, which has no setter and never
  changes, unless `countFrozen` is set.
- `dispatch` from a `useReducer`: one event is the shape this rule asks for.
- A setter that comes from a prop or a context hook (`const { setItems } = useCart()`): only a
  setter destructured from a local `useState` is resolved.
- Setters called in the hook body itself rather than in a nested function.
- A hook at exactly `max` slots, or an action at exactly `maxSettersPerFunction` setters.
- Files whose basename does not end with a `hookFileSuffixes` entry: components, plain modules and
  `*.queries.ts` files are out of scope.
- A setter from an aliased `useState` import is not resolved, so it is missing from the setter
  count (its slot still counts toward `max`).

```ts good filename=src/auth/CodeStep.hooks.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

export function useCodeStep() {
  const [startedAt] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const boxes = useRef<HTMLDivElement>(null);
  const limits = useQuery({ queryKey: ['limits'] });
  const check = useMutation({ mutationFn: async (typed: string) => typed });
  return { startedAt, code, setCode, boxes, limits, busy: check.isPending };
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max` | `integer` (≥1) | `4` | Most `useState` / `useReducer` slots one hook may keep. |
| `maxSettersPerFunction` | `integer` (≥0) | `3` | Most distinct `useState` setters one function nested in a hook may call. `0` turns this check off. |
| `countFrozen` | `boolean` | `false` | Also count a `useState` whose setter is never destructured. |
| `hookFileSuffixes` | `string[]` | `['.hooks.ts', '.hooks.tsx']` | Basename suffixes identifying the hook files to check. |
| `fileSuffixes` | `string[]` | none | Alias of `hookFileSuffixes`, the name `max-hooks-per-file` uses. When both are set, the suffixes are combined. |

```js
'noctcore-react/max-state-per-hook': ['error', { max: 4, maxSettersPerFunction: 3 }]
```

## When not to use it

If your hooks deliberately keep many independent pieces of state (a settings panel of unrelated
toggles, say), raise `max` or set `maxSettersPerFunction` to `0` for those files. If you do not
keep hooks in a dotted-role file (`*.hooks.ts`), point `hookFileSuffixes` at your own convention or
leave the rule off.

## Related

- [`max-hooks-per-file`](https://noctcore.github.io/eslint-plugins/rules/react/max-hooks-per-file/)
  caps how many hooks a file exports; this rule caps what one hook keeps inside.
- [`max-hook-return-surface`](https://noctcore.github.io/eslint-plugins/rules/react/max-hook-return-surface/)
  caps what a hook returns; a hook can keep its return surface and move its state into a reducer.
