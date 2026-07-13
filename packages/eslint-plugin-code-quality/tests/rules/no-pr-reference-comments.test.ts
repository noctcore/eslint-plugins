import { ruleTester } from '@noctcore/eslint-test-utils';

import { noPrReferenceCommentsRule } from '../../src/rules/no-pr-reference-comments';

ruleTester.run('no-pr-reference-comments', noPrReferenceCommentsRule, {
  valid: [
    { code: '// Trust-proxy depth for single-host Traefik.' },
    { code: '// See the expressjs proxies guide for the rationale.' },
    { code: 'const channel = "#general";' },
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
  ],
});
