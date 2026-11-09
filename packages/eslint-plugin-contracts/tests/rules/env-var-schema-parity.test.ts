import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';
import { Linter } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

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
    // Keys the runtime defines are never undeclared.
    {
      code: `const dev = import.meta.env.DEV; const mode = import.meta.env.MODE; const base = import.meta.env.BASE_URL;`,
      filename: FILE,
      options,
    },
    // A destructure of declared keys, and a rest element.
    {
      code: `const { DATABASE_URL, PORT: port, ...rest } = process.env;`,
      filename: FILE,
      options,
    },
  ],
  invalid: [
    // A destructured key is checked like a member read.
    {
      code: `const { DATABASE_URL, MISSING_KEY } = process.env;`,
      filename: FILE,
      options,
      errors: [{ messageId: 'undeclaredEnvVar', data: { name: 'MISSING_KEY', schema: SCHEMA } }],
    },
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

describe('env schema on a real, changing file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-var-schema-parity-'));
  const schema = path.join(dir, '.env.example');
  const linter = new Linter({ configType: 'flat' });
  const lint = (): number =>
    linter.verify('const key = process.env.API_KEY;', [
      {
        plugins: { contracts: { rules: { rule: envVarSchemaParityRule } } },
        rules: { 'contracts/rule': ['error', { schema }] },
      },
    ]).length;

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('re-reads the schema when it changes on disk', () => {
    writeFileSync(schema, 'DATABASE_URL=x\n');
    utimesSync(schema, new Date(1_000), new Date(1_000));
    expect(lint()).toBe(1);

    writeFileSync(schema, 'DATABASE_URL=x\nAPI_KEY=y\n');
    utimesSync(schema, new Date(2_000), new Date(2_000));
    expect(lint()).toBe(0);
  });
});
