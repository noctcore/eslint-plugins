import { ruleTester } from '@noctcore/eslint-test-utils';

import { noPrReferenceCommentsRule } from '../../src/rules/no-pr-reference-comments';

ruleTester.run('no-pr-reference-comments', noPrReferenceCommentsRule, {
  valid: [
    { code: '// Trust-proxy depth for single-host Traefik.' },
    { code: '// See the expressjs proxies guide for the rationale.' },
    { code: 'const channel = "#general";' },
    // A hex colour, a percentage and a one-digit step are prose.
    { code: '// fallback colour is #000 at 50%' },
    { code: '// step #2 of the wizard' },
    { code: '// opacity #40% on hover' },
    // Tracker keys are only matched when configured.
    { code: '// see ABC-123' },
    { code: '// encode as UTF-8', options: [{ trackerPatterns: ['(?:ABC|OPS)-\\d+'] }] },
  ],
  invalid: [
    {
      code: '// See https://github.com/noctcore/eslint-plugins/pull/42 for context.',
      errors: [{ messageId: 'prReferenceComment' }],
    },
    {
      code: '// fixes #123',
      errors: [{ messageId: 'prReferenceComment' }],
    },
    {
      code: '// workaround (#88)',
      errors: [{ messageId: 'prReferenceComment' }],
    },
    {
      code: '// see ABC-123',
      options: [{ trackerPatterns: ['(?:ABC|OPS)-\\d+'] }],
      errors: [{ messageId: 'prReferenceComment', data: { label: 'tracker reference', snippet: 'ABC-123' } }],
    },
  ],
});
