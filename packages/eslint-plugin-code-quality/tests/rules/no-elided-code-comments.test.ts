import { ruleTester } from '@noctcore/eslint-test-utils';

import { noElidedCodeCommentsRule } from '../../src/rules/no-elided-code-comments';

const error = { messageId: 'elidedCode' as const };
const jsx = { parserOptions: { ecmaFeatures: { jsx: true } } };

ruleTester.run('no-elided-code-comments', noElidedCodeCommentsRule, {
  valid: [
    // An ellipsis in ordinary prose.
    { code: '// wait... this is intentional: the retry has already backed off.' },
    { code: '// Loading... is shown until the first page arrives.' },
    // A bare ellipsis, and commented-out spread syntax.
    { code: 'function noop() { /* ... */ }' },
    { code: '// return { ...rest, id };' },
    { code: 'const merged = { ...defaults, ...overrides }; // ...overrides win' },
    // Section headers that name a group of code without claiming it was left out.
    { code: '// Other helpers\nfunction helper() {}' },
    { code: '// More tests for the edge cases\nit.todo("x");' },
    { code: '// Existing users keep their plan until renewal.' },
    { code: "// same setup as before\nrender('app');" },
    // A test describing the data it asserts on, and a note about a spread.
    { code: '// Other fields unchanged\nexpect(state.brightness).toBe(1);' },
    { code: 'const next = {\n  // ...other fields unchanged\n  ...previous,\n  retries: 3,\n};' },
    // "rest of" inside a real explanation.
    { code: '// The rest of the function assumes the list is sorted.' },
    { code: '// rest of the tests share this fixture' },
    // "unchanged" as a plain note next to a value.
    { code: 'const next = {\n  // unchanged\n  retries: 3,\n};' },
    { code: 'const next = { ...prev, retries: 3 }; // retries unchanged on purpose' },
    // Tracked placeholders are a separate concern.
    { code: '// TODO: implementation goes here' },
    { code: '// FIXME: ... rest of the validation' },
    // JSDoc is exempt, including @example blocks that elide code.
    {
      code: '/**\n * @example\n * function setup() {\n *   // ... existing code ...\n * }\n */\nexport function setup() {}',
    },
    { code: "// Your code will be reviewed before merge.\nconst x = 1;" },
  ],
  invalid: [
    { code: 'function f() {\n  // ... existing code ...\n  return 1;\n}', errors: [error] },
    { code: '// …existing code…', errors: [error] },
    { code: '// existing code', errors: [error] },
    { code: '// ...rest of the code', errors: [error] },
    { code: '// Rest of the file', errors: [error] },
    { code: '/* rest of the function unchanged */', errors: [error] },
    { code: '// (rest of file unchanged)', errors: [error] },
    { code: '// [rest of implementation remains the same]', errors: [error] },
    { code: '// (unchanged)', errors: [error] },
    { code: '// ... unchanged ...', errors: [error] },
    { code: '// ... same as before', errors: [error] },
    { code: '// your code here', errors: [error] },
    { code: '// Add your own logic here', errors: [error] },
    { code: '// implementation goes here', errors: [error] },
    { code: '// validation logic goes here', errors: [error] },
    { code: 'class A {\n  // ... other methods ...\n}', errors: [error] },
    { code: '// ... more tests', errors: [error] },
    { code: '// other handlers omitted for brevity', errors: [error] },
    { code: '<Button\n  // ... other props ...\n/>;', errors: [error], languageOptions: jsx },
    { code: '// remaining fields omitted', errors: [error] },
    { code: '// Keep existing imports ...', errors: [error] },
    { code: '// everything else stays the same', errors: [error] },
    {
      code: 'const App = () => (\n  <div>\n    {/* ... existing code ... */}\n  </div>\n);',
      errors: [error],
      languageOptions: jsx,
    },
  ],
});
