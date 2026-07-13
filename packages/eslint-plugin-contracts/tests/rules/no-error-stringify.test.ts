import { ruleTester } from '@noctcore/eslint-test-utils';

import { noErrorStringifyRule } from '../../src/rules/no-error-stringify';

ruleTester.run('no-error-stringify', noErrorStringifyRule, {
  valid: [
    // The guarded extractor idiom is the intended pattern and stays legal.
    {
      code: 'const msg = error instanceof Error ? error.message : String(error);',
    },
    { code: 'logger.error("failed", error instanceof Error ? error.stack : String(error));' },
    // Member access, not stringify.
    { code: 'const m = `${error.message}`;' },
    // Bare String(error) is intentionally not policed (guarded idiom uses it).
    { code: 'const s = String(error);' },
    { code: 'const total = count + "";' },
    // Custom identifier set: `error` is no longer treated as an error name.
    {
      code: 'const msg = `${error}`;',
      options: [{ errorIdentifierNames: ['cause'] }],
    },
  ],
  invalid: [
    {
      code: 'logger.error(`request failed: ${error}`);',
      errors: [{ messageId: 'noErrorStringify' }],
    },
    {
      code: 'const msg = err.toString();',
      errors: [{ messageId: 'noErrorStringify' }],
    },
    {
      code: 'const msg = error + "";',
      errors: [{ messageId: 'noErrorStringify' }],
    },
    {
      code: 'const msg = "" + e;',
      errors: [{ messageId: 'noErrorStringify' }],
    },
    // Custom identifier set flags a name the default would miss.
    {
      code: 'const msg = `${failure}`;',
      options: [{ errorIdentifierNames: ['failure'] }],
      errors: [{ messageId: 'noErrorStringify' }],
    },
  ],
});
