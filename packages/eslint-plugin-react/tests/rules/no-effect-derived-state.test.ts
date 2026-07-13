import { ruleTester } from '@noctcore/eslint-test-utils';

import { noEffectDerivedStateRule } from '../../src/rules/no-effect-derived-state';

const FILE = 'Panel.tsx';

ruleTester.run('no-effect-derived-state', noEffectDerivedStateRule, {
  valid: [
    // Setter argument is a call — could be impure, so we bail (conservative).
    {
      code: `useEffect(() => { setX(compute(a)); }, [a]);`,
      filename: FILE,
    },
    // Argument reaches outside the dependency array (`b` is not a dep).
    {
      code: `useEffect(() => { setX(a + b); }, [a]);`,
      filename: FILE,
    },
    // No dependency array — cannot verify the derivation.
    {
      code: `useEffect(() => { setX(a); });`,
      filename: FILE,
    },
    // Constant init — no dependency is actually read.
    {
      code: `useEffect(() => { setX(0); }, [a]);`,
      filename: FILE,
    },
    // A branch means it is more than pure derivation.
    {
      code: `useEffect(() => { if (a) setX(a); }, [a]);`,
      filename: FILE,
    },
    // A cleanup return means the body is not solely setters.
    {
      code: `useEffect(() => { setX(a); return () => {}; }, [a]);`,
      filename: FILE,
    },
    // An extra non-setter statement (a side effect) bails.
    {
      code: `useEffect(() => { track('x'); setX(a); }, [a]);`,
      filename: FILE,
    },
    // Async effects are out of scope.
    {
      code: `useEffect(async () => { setX(a); }, [a]);`,
      filename: FILE,
    },
  ],
  invalid: [
    // Canonical derived-state: full name from first + last.
    {
      code: `useEffect(() => { setFullName(first + ' ' + last); }, [first, last]);`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Derived from a prop member.
    {
      code: `useEffect(() => { setLabel(props.name); }, [props.name]);`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Derived via a ternary over a dep.
    {
      code: `useEffect(() => { setStatus(count > 0 ? 'on' : 'off'); }, [count]);`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Multiple setters, all derived — reported once on the effect.
    {
      code: `useEffect(() => { setFull(first + last); setInitial(first); }, [first, last]);`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
  ],
});
