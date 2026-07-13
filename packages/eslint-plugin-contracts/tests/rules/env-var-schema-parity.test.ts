import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { envVarSchemaParityRule } from '../../src/rules/env-var-schema-parity';

const FILE = 'src/config.ts';

// Absolute path to the fixture, so schema resolution is independent of cwd.
const SCHEMA = fileURLToPath(new URL('../fixtures/env.example', import.meta.url));

const options = [{ schema: SCHEMA }] as const;

ruleTester.run('env-var-schema-parity', envVarSchemaParityRule, {
  valid: [
    // Declared key via process.env.
    {
      code: `const url = process.env.DATABASE_URL;`,
      filename: FILE,
      options,
    },
    // Declared key via import.meta.env.
    {
      code: `const port = import.meta.env.PORT;`,
      filename: FILE,
      options,
    },
    // Computed access is not policed.
    {
      code: `const v = process.env[dynamicKey];`,
      filename: FILE,
      options,
    },
    // Inert with no schema configured.
    {
      code: `const v = process.env.ANYTHING_GOES;`,
      filename: FILE,
      options: [{}],
    },
    // Inert when the schema file cannot be read.
    {
      code: `const v = process.env.ANYTHING_GOES;`,
      filename: FILE,
      options: [{ schema: '/nonexistent/does-not-exist.env' }],
    },
  ],
  invalid: [
    // Undeclared key read from process.env.
    {
      code: `const secret = process.env.MISSING_KEY;`,
      filename: FILE,
      options,
      errors: [{ messageId: 'undeclaredEnvVar' }],
    },
    // Undeclared key read from import.meta.env.
    {
      code: `const flag = import.meta.env.ALSO_MISSING;`,
      filename: FILE,
      options,
      errors: [{ messageId: 'undeclaredEnvVar' }],
    },
  ],
});
