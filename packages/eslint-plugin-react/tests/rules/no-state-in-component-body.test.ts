import { ruleTester } from '@noctcore/eslint-test-utils';

import { noStateInComponentBodyRule } from '../../src/rules/no-state-in-component-body';

// De-projected: the rule keys off the file extension (`.tsx` = component shell)
// and the configurable hook-file suffix (default `.hooks.ts`), never a folder
// layout — so a loose `TaskDetail.tsx` is checked just like a colocated one.
const COMPONENT = 'TaskDetail.tsx';
const HOOK = 'TaskDetail.hooks.ts';

ruleTester.run('no-state-in-component-body', noStateInComponentBodyRule, {
  valid: [
    // Render-safe hooks are allowlisted.
    {
      code: `import { useId } from 'react';\nexport default function TaskDetail() { const id = useId(); return null; }`,
      filename: COMPONENT,
    },
    // Non-flagged custom presentational hooks are fine in the shell.
    {
      code: `export default function TaskDetail({ view }: { view: unknown }) { return null; }`,
      filename: COMPONENT,
    },
    // useTransition / useDeferredValue are render-safe.
    {
      code: `import { useTransition } from 'react';\nexport default function TaskDetail() { const [p] = useTransition(); return null; }`,
      filename: COMPONENT,
    },
    // The same hook is the correct home in a `.hooks.ts` file.
    {
      code: `import { useState } from 'react';\nexport function useTaskDetail() { return useState(0); }`,
      filename: HOOK,
    },
    // Stateful hooks in a non-component (`.ts`) file are not gated.
    {
      code: `import { useState } from 'react';\nexport function useThing() { return useState(0); }`,
      filename: 'use-thing.ts',
    },
    // A custom hook-file suffix redirects the "correct home" — here the state
    // hook is allowed because the file matches `hookFileSuffixes`.
    {
      code: `import { useState } from 'react';\nexport function useTaskDetail() { return useState(0); }`,
      filename: 'TaskDetail.state.tsx',
      options: [{ hookFileSuffixes: ['.state.tsx'] }],
    },
  ],
  invalid: [
    {
      code: `import { useState } from 'react';\nexport default function TaskDetail() { const [n] = useState(0); return null; }`,
      filename: COMPONENT,
      errors: [{ messageId: 'stateInBody' }],
    },
    {
      code: `import { useEffect } from 'react';\nexport default function TaskDetail() { useEffect(() => {}, []); return null; }`,
      filename: COMPONENT,
      errors: [{ messageId: 'stateInBody' }],
    },
    {
      code: `export default function TaskDetail() { const q = useQuery({}); return null; }`,
      filename: COMPONENT,
      errors: [{ messageId: 'stateInBody' }],
    },
    // Zustand store hook (use*Store) read in the body.
    {
      code: `export default function TaskDetail() { const s = useBoardStore((x) => x); return null; }`,
      filename: COMPONENT,
      errors: [{ messageId: 'stateInBody' }],
    },
    // additionalHooks extends the flagged set.
    {
      code: `export default function TaskDetail() { const t = useBridge(); return null; }`,
      filename: COMPONENT,
      options: [{ additionalHooks: ['useBridge'] }],
      errors: [{ messageId: 'stateInBody' }],
    },
    // Layout-independent: a `.tsx` NOT in a folder-per-component layout is still
    // a component shell and is checked.
    {
      code: `import { useState } from 'react';\nexport default function Widget() { const [n] = useState(0); return null; }`,
      filename: 'src/widgets/misc.tsx',
      errors: [{ messageId: 'stateInBody' }],
    },
  ],
});
