import { ruleTester } from '@noctcore/eslint-test-utils';

import { noEffectDerivedStateRule } from '../../src/rules/no-effect-derived-state';

const FILE = 'Panel.tsx';

ruleTester.run('no-effect-derived-state', noEffectDerivedStateRule, {
  valid: [
    // Setter argument is a call — could be impure, so we bail (conservative).
    {
      code: `const [x, setX] = useState(0); useEffect(() => { setX(compute(a)); }, [a]);`,
      filename: FILE,
    },
    // Argument reaches outside the dependency array (`b` is not a dep).
    {
      code: `const [x, setX] = useState(0); useEffect(() => { setX(a + b); }, [a]);`,
      filename: FILE,
    },
    // No dependency array — cannot verify the derivation.
    {
      code: `const [x, setX] = useState(0); useEffect(() => { setX(a); });`,
      filename: FILE,
    },
    // Constant init — no dependency is actually read.
    {
      code: `const [x, setX] = useState(0); useEffect(() => { setX(0); }, [a]);`,
      filename: FILE,
    },
    // A branch means it is more than pure derivation.
    {
      code: `const [x, setX] = useState(0); useEffect(() => { if (a) setX(a); }, [a]);`,
      filename: FILE,
    },
    // A cleanup return means the body is not solely setters.
    {
      code: `const [x, setX] = useState(0); useEffect(() => { setX(a); return () => {}; }, [a]);`,
      filename: FILE,
    },
    // An extra non-setter statement (a side effect) bails.
    {
      code: `const [x, setX] = useState(0); useEffect(() => { track('x'); setX(a); }, [a]);`,
      filename: FILE,
    },
    // Async effects are out of scope.
    {
      code: `const [x, setX] = useState(0); useEffect(async () => { setX(a); }, [a]);`,
      filename: FILE,
    },
    // A setter from a context hook syncs an external store.
    {
      code: `function C({ title }) { const { setPageTitle } = usePageMeta(); useEffect(() => { setPageTitle(title); }, [title]); }`,
      filename: FILE,
    },
    // Timers are not state setters.
    {
      code: `function C({ tick, delay }) { useEffect(() => { setInterval(tick, delay); }, [tick, delay]); }`,
      filename: FILE,
    },
    // Prop-to-state with local edits: the state is seeded from the same dependency.
    {
      code: `function C({ value }) { const [draft, setDraft] = useState(value); useEffect(() => { setDraft(value); }, [value]); }`,
      filename: FILE,
    },
    // A setter passed in as a prop.
    {
      code: `function C({ value, setValue }) { useEffect(() => { setValue(value * 2); }, [value]); }`,
      filename: FILE,
    },
  ],
  invalid: [
    // Canonical derived-state: full name from first + last.
    {
      code: `function C({ first, last }) { const [fullName, setFullName] = useState(''); useEffect(() => { setFullName(first + ' ' + last); }, [first, last]); }`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Derived from a prop member.
    {
      code: `function C(props) { const [label, setLabel] = React.useState(''); useEffect(() => { setLabel(props.name); }, [props.name]); }`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Derived via a ternary over a dep.
    {
      code: `function C({ count }) { const [status, setStatus] = useState('off'); useEffect(() => { setStatus(count > 0 ? 'on' : 'off'); }, [count]); }`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
    // Multiple setters, all derived — reported once on the effect.
    {
      code: `function C({ first, last }) { const [full, setFull] = useState(''); const [initial, setInitial] = useState(''); useEffect(() => { setFull(first + last); setInitial(first); }, [first, last]); }`,
      filename: FILE,
      errors: [{ messageId: 'derivedState' }],
    },
  ],
});
