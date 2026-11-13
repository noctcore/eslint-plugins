import { ruleTester } from '@noctcore/eslint-test-utils';

import { bcryptRoundsMinRule } from '../../src/rules/bcrypt-rounds-min';

const TS = 'auth.ts';

function tooLow(method: string, cost: number, minRounds = 10) {
  return [
    {
      messageId: 'roundsTooLow' as const,
      data: { method, cost: String(cost), minRounds: String(minRounds) },
    },
  ];
}

ruleTester.run('bcrypt-rounds-min', bcryptRoundsMinRule, {
  valid: [
    // At or above the default minimum.
    { code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 12);`, filename: TS },
    { code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 10);`, filename: TS },
    { code: `const bcrypt = require('bcryptjs'); bcrypt.genSaltSync(11);`, filename: TS },
    // A non-literal cost is accepted on trust.
    { code: `import { hash } from 'bcrypt'; await hash(password, env.BCRYPT_ROUNDS);`, filename: TS },
    // A precomputed salt string in place of the cost.
    {
      code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, '$2b$12$abcdefghijklmnopqrstuu');`,
      filename: TS,
    },
    // A local function named like a bcrypt export.
    { code: `function hash(a, b) {} hash(password, 4);`, filename: TS },
    // An import of `hash` from another module.
    { code: `import { hash } from './crypto'; hash(password, 4);`, filename: TS },
    // A `hash` method on a module that is not bcrypt.
    { code: `import crypto from 'node:crypto'; crypto.hash('sha256', data, 4);`, filename: TS },
    // An unbound global `bcrypt` is not tracked.
    { code: `bcrypt.hash(password, 4);`, filename: TS },
    // A parameter shadows the import.
    { code: `import { hash } from 'bcrypt'; function f(hash) { return hash(password, 4); }`, filename: TS },
    // A bcrypt function without a cost argument.
    { code: `import bcrypt from 'bcrypt'; bcrypt.compare(password, 4);`, filename: TS },
    // A missing cost argument.
    { code: `import bcrypt from 'bcrypt'; bcrypt.hash(password);`, filename: TS },
    // A spread in the cost position.
    { code: `import bcrypt from 'bcrypt'; bcrypt.hash(password, ...args);`, filename: TS },
    // A computed member is not followed.
    { code: `import bcrypt from 'bcrypt'; bcrypt['hash'](password, 4);`, filename: TS },
    // A destructured name that is not a tracked function.
    { code: `const { compare } = require('bcrypt'); compare(password, 4);`, filename: TS },
    // A raised minimum, met.
    { code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 14);`, filename: TS, options: [{ minRounds: 14 }] },
    // A configured module list replaces the default, so `bcrypt` is no longer tracked.
    {
      code: `import bcrypt from 'bcrypt'; bcrypt.hash(password, 4);`,
      filename: TS,
      options: [{ bcryptModules: ['@node-rs/bcrypt'] }],
    },
  ],
  invalid: [
    { code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 8);`, filename: TS, errors: tooLow('hash', 8) },
    { code: `import bcrypt from 'bcrypt'; bcrypt.hashSync(password, 4);`, filename: TS, errors: tooLow('hashSync', 4) },
    { code: `import bcrypt from 'bcrypt'; await bcrypt.genSalt(6);`, filename: TS, errors: tooLow('genSalt', 6) },
    {
      code: `import * as bcrypt from 'bcryptjs'; bcrypt.genSaltSync(9);`,
      filename: TS,
      errors: tooLow('genSaltSync', 9),
    },
    { code: `import { hash } from 'bcrypt'; await hash(password, 8);`, filename: TS, errors: tooLow('hash', 8) },
    { code: `import { hashSync as h } from 'bcryptjs'; h(password, 5);`, filename: TS, errors: tooLow('hashSync', 5) },
    { code: `const bcrypt = require('bcrypt'); bcrypt.hash(password, 8);`, filename: TS, errors: tooLow('hash', 8) },
    { code: `const { hash } = require('bcrypt'); hash(password, 8);`, filename: TS, errors: tooLow('hash', 8) },
    { code: `const { genSalt: salt } = require('bcryptjs'); salt(7);`, filename: TS, errors: tooLow('genSalt', 7) },
    {
      code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 8 as number);`,
      filename: TS,
      errors: tooLow('hash', 8),
    },
    // Resolved from inside a nested function.
    {
      code: `import bcrypt from 'bcrypt'; export async function register(password) { return bcrypt.hash(password, 9); }`,
      filename: TS,
      errors: tooLow('hash', 9),
    },
    // A raised minimum.
    {
      code: `import bcrypt from 'bcrypt'; await bcrypt.hash(password, 12);`,
      filename: TS,
      options: [{ minRounds: 14 }],
      errors: tooLow('hash', 12, 14),
    },
    // A configured module is tracked.
    {
      code: `import bcrypt from '@node-rs/bcrypt'; bcrypt.hashSync(password, 4);`,
      filename: TS,
      options: [{ bcryptModules: ['@node-rs/bcrypt'] }],
      errors: tooLow('hashSync', 4),
    },
  ],
});
