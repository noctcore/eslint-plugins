import { ruleTester } from '@noctcore/eslint-test-utils';

import { noBareDateNowRule } from '../../src/rules/no-bare-date-now';

const options = [{ allowIn: ['**/clock.ts', '**/*.timing.ts'] }] as const;

ruleTester.run('no-bare-date-now', noBareDateNowRule, {
  valid: [
    // Clock util replacements.
    {
      code: `const t = nowMs();`,
      filename: 'src/lib/token.ts',
      options,
    },
    {
      code: `const d = now();`,
      filename: 'src/lib/token.ts',
      options,
    },
    // `new Date(value)` with an argument is a parse, not a bare read.
    {
      code: `const d = new Date(nowMs() + 1000);`,
      filename: 'src/lib/token.ts',
      options,
    },
    {
      code: `const d = new Date('2026-01-01T00:00:00Z');`,
      filename: 'src/lib/token.ts',
      options,
    },
    // Allowlisted files keep bare Date (the clock util and timing sites).
    {
      code: `export function nowMs() { return Date.now(); }`,
      filename: 'packages/shared/src/clock.ts',
      options,
    },
    {
      code: `const start = Date.now();`,
      filename: 'src/request.timing.ts',
      options,
    },
    // Test files fake the clock instead; exempt under the default options.
    { code: `it('x', () => { const d = new Date(); });`, filename: 'src/a.test.ts' },
    { code: `const t = Date.now();`, filename: 'src/__tests__/token.ts' },
    // The default still allows the clock util.
    { code: `export const nowMs = () => Date.now();`, filename: 'src/lib/clock.ts' },
  ],
  invalid: [
    // Default options still report production code.
    { code: `const t = Date.now();`, filename: 'src/lib/token.ts', errors: [{ messageId: 'dateNow' }] },
    // Date() called as a function, and reads through the global object.
    { code: `const s = Date();`, filename: 'src/lib/token.ts', options, errors: [{ messageId: 'dateCall' }] },
    { code: `const t = globalThis.Date.now();`, filename: 'src/lib/token.ts', options, errors: [{ messageId: 'dateNow' }] },
    { code: `const d = new window.Date();`, filename: 'src/lib/token.ts', options, errors: [{ messageId: 'newDate' }] },
    {
      code: `const t = Date.now();`,
      filename: 'src/lib/token.ts',
      options,
      errors: [{ messageId: 'dateNow' }],
    },
    {
      code: `const d = new Date();`,
      filename: 'src/lib/token.ts',
      options,
      errors: [{ messageId: 'newDate' }],
    },
  ],
});
