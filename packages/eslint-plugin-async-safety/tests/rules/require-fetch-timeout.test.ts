import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireFetchTimeoutRule } from '../../src/rules/require-fetch-timeout';

ruleTester.run('require-fetch-timeout', requireFetchTimeoutRule, {
  valid: [
    // A signal is present.
    { code: `fetch(url, { signal: controller.signal });` },
    { code: `fetch(url, { signal: AbortSignal.timeout(1000) });` },
    // Shorthand signal.
    { code: `fetch(url, { signal });` },
    // A `timeout` option counts.
    { code: `fetch(url, { timeout: 5000 });` },
    // Opaque options bag (identifier) — may already set a signal → not our call to make.
    { code: `fetch(url, opts);` },
    // Spread argument — opaque.
    { code: `fetch(url, ...rest);` },
    // Spread inside the options object — opaque.
    { code: `fetch(url, { ...base });` },
    // A bare identifier URL could be a Request carrying its own signal.
    { code: `fetch(request);` },
    // Not the global fetch.
    { code: `this.fetch('https://x');` },
    { code: `client.fetch('https://x');` },
    // A configured wrapper called with an opaque config identifier.
    { code: `axios(config);`, options: [{ callees: ['axios'] }] },
    { code: `undici.request('https://x', { signal });`, options: [{ callees: ['undici.request'] }] },
  ],
  invalid: [
    // Bare string URL, no options — suggestion appends an options object.
    {
      code: `fetch('https://api.example.com');`,
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `fetch('https://api.example.com', { signal: AbortSignal.timeout(10000) });`,
            },
          ],
        },
      ],
    },
    // Empty options object — suggestion fills it.
    {
      code: `fetch('https://x', {});`,
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `fetch('https://x', { signal: AbortSignal.timeout(10000) });`,
            },
          ],
        },
      ],
    },
    // Options object with unrelated keys — suggestion inserts before the first prop.
    {
      code: `fetch('https://x', { method: 'POST' });`,
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `fetch('https://x', { signal: AbortSignal.timeout(10000), method: 'POST' });`,
            },
          ],
        },
      ],
    },
    // An options object with a variable URL still reports — the object is visible.
    {
      code: `fetch(url, { method: 'POST' });`,
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `fetch(url, { signal: AbortSignal.timeout(10000), method: 'POST' });`,
            },
          ],
        },
      ],
    },
    // Template-literal URL, no options.
    {
      code: 'fetch(`https://x/${id}`);',
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: 'fetch(`https://x/${id}`, { signal: AbortSignal.timeout(10000) });',
            },
          ],
        },
      ],
    },
    // Custom default timeout flows into the suggestion + message.
    {
      code: `fetch('https://x');`,
      options: [{ defaultTimeoutMs: 3000 }],
      errors: [
        {
          messageId: 'missingTimeout',
          data: { callee: 'fetch', ms: 3000 },
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `fetch('https://x', { signal: AbortSignal.timeout(3000) });`,
            },
          ],
        },
      ],
    },
    // A configured wrapper with a visible signal-free options object.
    {
      code: `undici.request('https://x', { method: 'GET' });`,
      options: [{ callees: ['undici.request'] }],
      errors: [
        {
          messageId: 'missingTimeout',
          data: { callee: 'undici.request', ms: 10000 },
          suggestions: [
            {
              messageId: 'addTimeout',
              output: `undici.request('https://x', { signal: AbortSignal.timeout(10000), method: 'GET' });`,
            },
          ],
        },
      ],
    },
  ],
});
