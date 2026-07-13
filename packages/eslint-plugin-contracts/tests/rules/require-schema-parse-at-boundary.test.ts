import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireSchemaParseAtBoundaryRule } from '../../src/rules/require-schema-parse-at-boundary';

const FILE = 'src/api.ts';

ruleTester.run('require-schema-parse-at-boundary', requireSchemaParseAtBoundaryRule, {
  valid: [
    // Parsed at runtime — the intended shape.
    {
      code: `const user = UserSchema.parse(JSON.parse(raw));`,
      filename: FILE,
    },
    {
      code: `async function f(res) { return UserSchema.parse(await res.json()); }`,
      filename: FILE,
    },
    // Safe/neutral cast targets are never flagged.
    {
      code: `const data = JSON.parse(raw) as unknown;`,
      filename: FILE,
    },
    {
      code: `const data = JSON.parse(raw) as any;`,
      filename: FILE,
    },
    {
      code: `const tuple = JSON.parse(raw) as const;`,
      filename: FILE,
    },
    // Cast on a non-boundary value is out of scope for the syntactic slice.
    {
      code: `const user = value as User;`,
      filename: FILE,
    },
  ],
  invalid: [
    // JSON.parse asserted to a named shape.
    {
      code: `const user = JSON.parse(raw) as User;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // JSON.parse asserted to an array shape.
    {
      code: `const users = JSON.parse(raw) as User[];`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Awaited response body asserted instead of parsed.
    {
      code: `async function f(res) { const user = (await res.json()) as User; return user; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
  ],
});
