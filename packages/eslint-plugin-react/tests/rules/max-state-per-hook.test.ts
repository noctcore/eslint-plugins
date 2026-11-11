import { ruleTester } from '@noctcore/eslint-test-utils';

import { maxStatePerHookRule } from '../../src/rules/max-state-per-hook';

// De-projected: the only file assumption is the hook-file suffix (default
// `.hooks.ts` / `.hooks.tsx`), read from the basename; no folder layout.
const HOOKS = 'Checkout.hooks.ts';

function slots(count: number, prefix = 'v'): string {
  return Array.from(
    { length: count },
    (_, i) => `  const [${prefix}${i}, set${prefix.toUpperCase()}${i}] = useState(${i});`,
  ).join('\n');
}

const fourSlots = `
import { useState } from 'react';
export function useCheckout() {
${slots(4)}
  return { v0, v1, v2, v3 };
}
`;

const fiveSlots = `
import { useState } from 'react';
export function useCheckout() {
${slots(5)}
  return { v0, v1, v2, v3, v4 };
}
`;

// The offender shape: a code-entry step with a mutation, a query, three refs
// and nine useState slots, whose handlers each set four to eight of them.
const codeStepHook = `
import { useEffect, useRef, useState } from 'react';
import { useCheckCode, useSendCode } from './Auth.mutations';
import { useLimits } from './Auth.queries';

export function useCodeStep(email: string, onPassed: () => void) {
  const limits = useLimits();
  const checkCode = useCheckCode();
  const { mutateAsync: sendCode } = useSendCode();
  const [sentAt, setSentAt] = useState<number | null>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sending' | 'checking' | null>(null);
  const [said, setSaid] = useState<'wrong' | 'sent' | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const boxes = useRef<HTMLDivElement>(null);

  const afterSend = (answer: { ok: boolean; at: number }, first: boolean) => {
    setSentAt(answer.at);
    setBusy(null);
    setArriving(false);
    if (answer.ok) {
      setCode('');
      setDead(null);
      setSaid(first ? null : 'sent');
      setResendAt(Date.now());
    } else {
      setBlockedUntil(Date.now());
    }
  };

  useEffect(() => {
    if (!busy) return;
    setCode('');
    setSaid(null);
    setDead('expired');
  }, [busy]);

  const check = async (typed: string) => {
    setBusy('checking');
    setSaid(null);
    setAttempts(attempts + 1);
    const answer = await checkCode.mutateAsync({ email, code: typed }).catch(() => null);
    setBusy(null);
    setCode('');
    if (answer === 'ok') onPassed();
  };

  return { limits, sentAt, code, busy, said, dead, arriving, resendAt, blockedUntil, boxes, afterSend, check, sendCode };
}
`;

// One handler that settles a form: seven setters in a row.
const sevenSetterAction = `
import { useState } from 'react';
export function useProfileForm() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  const [g, setG] = useState(0);
  const reset = () => {
    setA(0);
    setB(0);
    setC(0);
    setD(0);
    setE(0);
    setF(0);
    setG(0);
  };
  return { a, b, c, d, e, f, g, reset };
}
`;

ruleTester.run('max-state-per-hook', maxStatePerHookRule, {
  valid: [
    // Exactly the max is fine.
    { code: fourSlots, filename: HOOKS },
    // `.hooks.tsx` is a hook file by default too.
    { code: fourSlots, filename: 'Checkout.hooks.tsx' },
    // Not a hook file: a component or plain module is out of scope.
    { code: fiveSlots, filename: 'Checkout.tsx' },
    { code: fiveSlots, filename: 'Checkout.ts' },
    { code: sevenSetterAction, filename: 'ProfileForm.ts' },
    // Frozen snapshots never change, so they do not count by default.
    {
      code: `
import { useState } from 'react';
export function useCheckout() {
${slots(4)}
  const [startedAt] = useState(() => Date.now());
  const [initialTab] = useState('card');
  return { v0, v1, v2, v3, startedAt, initialTab };
}
`,
      filename: HOOKS,
    },
    // Refs, queries, mutations, forms and external stores are not state slots.
    {
      code: `
import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useStore } from './store';
export function useCheckout() {
${slots(4)}
  const box = useRef(null);
  const other = useRef(0);
  const cart = useQuery({ queryKey: ['cart'] });
  const pay = useMutation({ mutationFn: async () => 1 });
  const form = useForm();
  const theme = useStore((s) => s.theme);
  return { v0, v1, v2, v3, box, other, cart, pay, form, theme };
}
`,
      filename: HOOKS,
    },
    // A private sub-hook keeps its own budget: four plus four is fine.
    {
      code: `
import { useState } from 'react';
function useCodeBoxes() {
${slots(4, 'b')}
  return { b0, b1, b2, b3 };
}
export function useCheckout() {
${slots(4)}
  const boxes = useCodeBoxes();
  return { v0, v1, v2, v3, boxes };
}
`,
      filename: HOOKS,
    },
    // A useReducer counts as one slot, however wide its state.
    {
      code: `
import { useReducer, useState } from 'react';
export function useCheckout() {
${slots(3)}
  const [step, dispatch] = useReducer(reducer, initial);
  return { v0, v1, v2, step, dispatch };
}
`,
      filename: HOOKS,
    },
    // Three setters in one action is at the limit.
    {
      code: `
import { useState } from 'react';
export function useCheckout() {
${slots(4)}
  const reset = () => { setV0(0); setV1(0); setV2(0); };
  return { v0, v1, v2, v3, reset };
}
`,
      filename: HOOKS,
    },
    // A setter called twice counts once.
    {
      code: `
import { useState } from 'react';
export function useCheckout() {
${slots(3)}
  const step = (ok: boolean) => {
    setV0(1);
    if (ok) { setV0(2); setV1(1); } else { setV0(3); setV2(1); }
  };
  return { v0, v1, v2, step };
}
`,
      filename: HOOKS,
    },
    // Setters from props, from a context hook and from a reducer are not counted.
    {
      code: `
import { useReducer, useState } from 'react';
import { useCart } from './cart';
export function useCheckout(setOpen: (v: boolean) => void) {
  const { setItems, setTotal } = useCart();
  const [, dispatch] = useReducer(reducer, initial);
  const [v0, setV0] = useState(0);
  const finish = () => {
    setOpen(false);
    setItems([]);
    setTotal(0);
    dispatch({ type: 'done' });
    setV0(0);
  };
  return { v0, finish };
}
`,
      filename: HOOKS,
    },
    // Arrow hook with an implicit return.
    {
      code: `import { useState } from 'react';\nexport const useFlag = () => useState(false);`,
      filename: HOOKS,
    },
    // Setters in the hook body itself are not an action.
    {
      code: `
import { useState } from 'react';
export function useCheckout(reset: boolean) {
${slots(4)}
  if (reset) { setV0(0); setV1(0); setV2(0); setV3(0); }
  return { v0, v1, v2, v3 };
}
`,
      filename: HOOKS,
    },
    // maxSettersPerFunction: 0 turns the action check off.
    { code: sevenSetterAction, filename: HOOKS, options: [{ max: 10, maxSettersPerFunction: 0 }] },
    // A raised max allows a wider hook.
    { code: fiveSlots, filename: HOOKS, options: [{ max: 5 }] },
    // Custom suffixes replace the defaults.
    { code: fiveSlots, filename: HOOKS, options: [{ hookFileSuffixes: ['.state.ts'] }] },
    { code: fiveSlots, filename: HOOKS, options: [{ fileSuffixes: ['.state.ts'] }] },
  ],
  invalid: [
    // One past the max reports once, on the hook name.
    {
      code: fiveSlots,
      filename: HOOKS,
      errors: [
        { messageId: 'tooMuchState', data: { hook: 'useCheckout', count: 5, max: 4 }, line: 3 },
      ],
    },
    // The offender: count A once, and every handler over three setters.
    {
      code: codeStepHook,
      filename: 'CodeStep.hooks.ts',
      errors: [
        { messageId: 'tooMuchState', data: { hook: 'useCodeStep', count: 9, max: 4 } },
        { messageId: 'tooManySetters', data: { count: 8, max: 3 } },
        { messageId: 'tooManySetters', data: { count: 4, max: 3 } },
      ],
    },
    // An action with seven setters reports count B (and the hook count A).
    {
      code: sevenSetterAction,
      filename: HOOKS,
      errors: [
        { messageId: 'tooMuchState', data: { hook: 'useProfileForm', count: 7, max: 4 } },
        { messageId: 'tooManySetters', data: { count: 7, max: 3 }, line: 11, column: 9 },
      ],
    },
    // Count B alone, with count A raised out of the way.
    {
      code: sevenSetterAction,
      filename: HOOKS,
      options: [{ max: 10 }],
      errors: [{ messageId: 'tooManySetters', data: { count: 7, max: 3 } }],
    },
    // An inline callback has no name: the report lands on the setter past the limit.
    {
      code: `
import { useEffect, useState } from 'react';
export function useCheckout() {
${slots(4)}
  useEffect(() => {
    load().then(() => {
      setV0(1);
      setV1(1);
      setV2(1);
      setV3(1);
    });
  }, []);
  return { v0, v1, v2, v3 };
}
`,
      filename: HOOKS,
      errors: [{ messageId: 'tooManySetters', data: { count: 4, max: 3 }, line: 13 }],
    },
    // Frozen snapshots count with countFrozen.
    {
      code: `
import { useState } from 'react';
export function useCheckout() {
${slots(4)}
  const [startedAt] = useState(() => Date.now());
  return { v0, v1, v2, v3, startedAt };
}
`,
      filename: HOOKS,
      options: [{ countFrozen: true }],
      errors: [{ messageId: 'tooMuchState', data: { hook: 'useCheckout', count: 5, max: 4 } }],
    },
    // React.useState through a namespace and an aliased import are both counted.
    {
      code: `
import * as React from 'react';
import { useState as useLocalState, useReducer as useMachine } from 'react';
export function useCheckout() {
  const [a, setA] = React.useState(0);
  const [b, setB] = React.useState(0);
  const [c, setC] = useLocalState(0);
  const [d] = useMachine(reducer, initial);
  const [e, setE] = useLocalState(0);
  return { a, b, c, d, e };
}
`,
      filename: HOOKS,
      errors: [{ messageId: 'tooMuchState', data: { hook: 'useCheckout', count: 5, max: 4 } }],
    },
    // A sub-hook over its own budget is reported by its own name, not the caller.
    {
      code: `
import { useState } from 'react';
function useCodeBoxes() {
${slots(5, 'b')}
  return { b0, b1, b2, b3, b4 };
}
export function useCheckout() {
${slots(2)}
  return { v0, v1, boxes: useCodeBoxes() };
}
`,
      filename: HOOKS,
      errors: [{ messageId: 'tooMuchState', data: { hook: 'useCodeBoxes', count: 5, max: 4 } }],
    },
    // A function expression hook and a `.hooks.tsx` file.
    {
      code: `import { useState } from 'react';\nexport const useCheckout = function () {\n${slots(5)}\n  return v0;\n};`,
      filename: 'Checkout.hooks.tsx',
      errors: [{ messageId: 'tooMuchState', data: { hook: 'useCheckout', count: 5, max: 4 } }],
    },
    // Both suffix names set: the lists are combined.
    {
      code: fiveSlots,
      filename: 'Checkout.state.ts',
      options: [{ hookFileSuffixes: ['.hooks.ts'], fileSuffixes: ['.state.ts'] }],
      errors: [{ messageId: 'tooMuchState' }],
    },
    {
      code: fiveSlots,
      filename: HOOKS,
      options: [{ hookFileSuffixes: ['.hooks.ts'], fileSuffixes: ['.state.ts'] }],
      errors: [{ messageId: 'tooMuchState' }],
    },
    // A custom setter limit.
    {
      code: sevenSetterAction,
      filename: HOOKS,
      options: [{ max: 10, maxSettersPerFunction: 6 }],
      errors: [{ messageId: 'tooManySetters', data: { count: 7, max: 6 } }],
    },
  ],
});
