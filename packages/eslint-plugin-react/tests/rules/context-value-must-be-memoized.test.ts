import { ruleTester } from '@noctcore/eslint-test-utils';

import { contextValueMustBeMemoizedRule } from '../../src/rules/context-value-must-be-memoized';

const TSX = 'TaskDetail.tsx';

// A memoized (stable) value passed to a `.Provider` — the correct shape.
const stableProviderValue = `
export function TaskDetail({ value }: Props) {
  return <TaskStreamContext.Provider value={value}>{null}</TaskStreamContext.Provider>;
}
`;

// A bare-context (React 19) provider with a stable value.
const stableBareContextValue = `
export function TaskDetail({ value }: Props) {
  return <TaskStreamContext value={value}>{null}</TaskStreamContext>;
}
`;

// A non-context element with an inline object attribute is untouched.
const inlineStyleOnDiv = `
export function TaskDetail() {
  return <div style={{ color: 'red' }} />;
}
`;

// A custom wrapper component (not matched) may take an inline value — its own
// call site is where memoization is enforced, not here.
const customWrapperInlineValue = `
export function TaskDetail() {
  return <BoardChromeProvider value={{ a: 1 }}>{null}</BoardChromeProvider>;
}
`;

// An inline object literal on a `.Provider` — the churn the rule forbids.
const inlineObjectOnProvider = `
export function TaskDetail() {
  return <TaskStreamContext.Provider value={{ a: 1, b: 2 }}>{null}</TaskStreamContext.Provider>;
}
`;

// The React 19 bare-context form with an inline object.
const inlineObjectOnBareContext = `
export function TaskDetail() {
  return <TaskStreamContext value={{ a: 1 }}>{null}</TaskStreamContext>;
}
`;

ruleTester.run('context-value-must-be-memoized', contextValueMustBeMemoizedRule, {
  valid: [
    { code: stableProviderValue, filename: TSX },
    { code: stableBareContextValue, filename: TSX },
    { code: inlineStyleOnDiv, filename: TSX },
    { code: customWrapperInlineValue, filename: TSX },
    // A file without JSX has nothing to report.
    { code: `export const x = 1;`, filename: 'actions.ts' },
    // A call may return a stable reference.
    { code: `export function P({ children }) { return <ThemeContext.Provider value={store.snapshot()}>{children}</ThemeContext.Provider>; }`, filename: TSX },
  ],
  invalid: [
    {
      code: inlineObjectOnProvider,
      filename: TSX,
      errors: [{ messageId: 'inlineValue' }],
    },
    {
      code: inlineObjectOnBareContext,
      filename: TSX,
      errors: [{ messageId: 'inlineValue' }],
    },
    // An inline array or function is a fresh reference too.
    {
      code: `export function P({ a, b, children }) { return <PairContext.Provider value={[a, b]}>{children}</PairContext.Provider>; }`,
      filename: TSX,
      errors: [{ messageId: 'inlineValue' }],
    },
    {
      code: `export function P({ children }) { return <ToggleContext value={() => setOpen(true)}>{children}</ToggleContext>; }`,
      filename: TSX,
      errors: [{ messageId: 'inlineValue' }],
    },
    // A .jsx file is scanned.
    {
      code: inlineObjectOnProvider,
      filename: 'TaskDetail.jsx',
      errors: [{ messageId: 'inlineValue' }],
    },
  ],
});
