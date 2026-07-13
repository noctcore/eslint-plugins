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
  ],
  invalid: [
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
