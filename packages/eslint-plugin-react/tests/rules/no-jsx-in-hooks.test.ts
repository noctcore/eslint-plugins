import { ruleTester } from '@noctcore/eslint-test-utils';

import { noJsxInHooksRule } from '../../src/rules/no-jsx-in-hooks';

const FILE = 'useThing.tsx';

ruleTester.run('no-jsx-in-hooks', noJsxInHooksRule, {
  valid: [
    // A hook returning data is fine.
    {
      code: `function useUserBadge(user: any) { return { label: user.name }; }`,
      filename: FILE,
    },
    // A hook returning a primitive.
    {
      code: `const useCount = () => 3;`,
      filename: FILE,
    },
    // A PascalCase component returning JSX is not a hook.
    {
      code: `function UserBadge({ user }: any) { return <span>{user.name}</span>; }`,
      filename: FILE,
    },
    // JSX returned from a NESTED function (a render callback) belongs to that
    // callback, not the hook.
    {
      code: `function useRows(items: any[]) { return items.map((i) => <li key={i} />); }`,
      filename: FILE,
    },
    // A hook returning the result of useMemo (a call, not literal JSX) is allowed.
    {
      code: `function useEl() { return useMemo(() => <div />, []); }`,
      filename: FILE,
    },
  ],
  invalid: [
    // Explicit JSX return from a hook-named function declaration.
    {
      code: `function useUserBadge(user: any) { return <span>{user.name}</span>; }`,
      filename: FILE,
      errors: [{ messageId: 'jsxInHook' }],
    },
    // Concise-body arrow assigned to a hook name.
    {
      code: `const useBadge = () => <span />;`,
      filename: FILE,
      errors: [{ messageId: 'jsxInHook' }],
    },
    // JSX via a ternary is still JSX.
    {
      code: `function useIcon(on: boolean) { return on ? <On /> : <Off />; }`,
      filename: FILE,
      errors: [{ messageId: 'jsxInHook' }],
    },
    // JSX via `&&`.
    {
      code: `const useMaybe = (show: boolean) => show && <span />;`,
      filename: FILE,
      errors: [{ messageId: 'jsxInHook' }],
    },
    // Fragment return.
    {
      code: `function useWrap() { return <></>; }`,
      filename: FILE,
      errors: [{ messageId: 'jsxInHook' }],
    },
  ],
});
