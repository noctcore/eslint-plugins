import { ruleTester } from '@noctcore/eslint-test-utils';

import { noHistoricalCommentsRule } from '../../src/rules/no-historical-comments';

ruleTester.run('no-historical-comments', noHistoricalCommentsRule, {
  valid: [
    { code: '// Resolve trace context, preferring the active span.' },
    { code: '// The pool size caps concurrent DB connections.' },
    // JSDoc blocks are exempt (they document current behavior).
    { code: '/**\n * We used to stringify here, but no longer.\n */\nconst x = 1;' },
    { code: 'const now = Date.now();' },
    // "no longer" describing runtime state, and "historical" as a domain word.
    { code: '// Once closed, the socket is no longer writable.' },
    { code: '// Historical exchange rates are cached for a day.' },
  ],
  invalid: [
    {
      code: '// We used to read process.env directly here.',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '// Before the fix this collapsed to {}.',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '// Kept for backwards compatibility with the old client.',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '/* This no longer applies after the rewrite. */',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '// We no longer retry here.',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '// The cache flag is no longer needed.',
      errors: [{ messageId: 'historicalComment' }],
    },
    {
      code: '// Historically this ran on every request.',
      errors: [{ messageId: 'historicalComment' }],
    },
  ],
});
