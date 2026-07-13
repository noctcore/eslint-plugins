import { ruleTester } from '@noctcore/eslint-test-utils';

import { preferLazyStateInitRule } from '../../src/rules/prefer-lazy-state-init';

const FILE = 'Panel.tsx';

ruleTester.run('prefer-lazy-state-init', preferLazyStateInitRule, {
  valid: [
    // Already lazy.
    { code: `const [s, setS] = useState(() => JSON.parse(raw));`, filename: FILE },
    // A plain literal initializer is cheap.
    { code: `const [n, setN] = useState(0);`, filename: FILE },
    // A member access, not a call.
    { code: `const [s, setS] = useState(props.initial);`, filename: FILE },
    // A call whose callee is not in the list.
    { code: `const [s, setS] = useState(compute());`, filename: FILE },
    // Not a useState call at all.
    { code: `const x = wrap(JSON.parse(raw));`, filename: FILE },
    // A bare identifier initializer (not a call).
    { code: `const [s, setS] = useState(initial);`, filename: FILE },
  ],
  invalid: [
    // JSON.parse — the canonical case.
    {
      code: `const [s, setS] = useState(JSON.parse(raw));`,
      filename: FILE,
      errors: [{ messageId: 'lazyInit' }],
      output: `const [s, setS] = useState(() => JSON.parse(raw));`,
    },
    // localStorage.getItem.
    {
      code: `const [s, setS] = useState(localStorage.getItem('k'));`,
      filename: FILE,
      errors: [{ messageId: 'lazyInit' }],
      output: `const [s, setS] = useState(() => localStorage.getItem('k'));`,
    },
    // sessionStorage.getItem.
    {
      code: `const [s, setS] = useState(sessionStorage.getItem('k'));`,
      filename: FILE,
      errors: [{ messageId: 'lazyInit' }],
      output: `const [s, setS] = useState(() => sessionStorage.getItem('k'));`,
    },
    // React.useState member form is matched too.
    {
      code: `const [s, setS] = React.useState(JSON.parse(raw));`,
      filename: FILE,
      errors: [{ messageId: 'lazyInit' }],
      output: `const [s, setS] = React.useState(() => JSON.parse(raw));`,
    },
    // A configured builder (bare name).
    {
      code: `const [s, setS] = useState(buildInitial());`,
      filename: FILE,
      options: [{ initializers: ['buildInitial'] }],
      errors: [{ messageId: 'lazyInit' }],
      output: `const [s, setS] = useState(() => buildInitial());`,
    },
  ],
});
