import { ruleTester } from '@noctcore/eslint-test-utils';

import { restrictThrowToTaxonomyRule } from '../../src/rules/restrict-throw-to-taxonomy';

const FILE = 'src/service.ts';

ruleTester.run('restrict-throw-to-taxonomy', restrictThrowToTaxonomyRule, {
  valid: [
    // `Error` is the default allowlist.
    {
      code: `throw new Error('boom');`,
      filename: FILE,
    },
    // Error with a cause is still an allowed class.
    {
      code: `try { work(); } catch (e) { throw new Error('boom', { cause: e }); }`,
      filename: FILE,
    },
    // Bare re-throw is left alone.
    {
      code: `try { work(); } catch (err) { throw err; }`,
      filename: FILE,
    },
    // Member and call throws are ambiguous — not policed syntactically.
    {
      code: `throw ctx.error;`,
      filename: FILE,
    },
    {
      code: `throw makeError('boom');`,
      filename: FILE,
    },
    // Custom taxonomy allows the project's base error.
    {
      code: `throw new AppError('boom');`,
      filename: FILE,
      options: [{ allow: ['Error', 'AppError'] }],
    },
  ],
  invalid: [
    // Built-in error not in the (default) allowlist.
    {
      code: `throw new TypeError('bad');`,
      filename: FILE,
      errors: [{ messageId: 'disallowedErrorClass' }],
    },
    {
      code: `throw new RangeError('bad');`,
      filename: FILE,
      errors: [{ messageId: 'disallowedErrorClass' }],
    },
    // Custom allowlist that excludes `Error`.
    {
      code: `throw new Error('boom');`,
      filename: FILE,
      options: [{ allow: ['AppError'] }],
      errors: [{ messageId: 'disallowedErrorClass' }],
    },
    // Non-Error values.
    {
      code: `throw 'boom';`,
      filename: FILE,
      errors: [{ messageId: 'nonErrorThrow' }],
    },
    {
      code: `throw 42;`,
      filename: FILE,
      errors: [{ messageId: 'nonErrorThrow' }],
    },
    {
      code: `throw { code: 500 };`,
      filename: FILE,
      errors: [{ messageId: 'nonErrorThrow' }],
    },
    {
      code: `throw [1, 2];`,
      filename: FILE,
      errors: [{ messageId: 'nonErrorThrow' }],
    },
    {
      code: 'throw `failed: ${reason}`;',
      filename: FILE,
      errors: [{ messageId: 'nonErrorThrow' }],
    },
  ],
});
