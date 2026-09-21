import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRealNetworkInUnitTestsRule } from '../../src/rules/no-real-network-in-unit-tests';

const unit = 'src/api/client.test.ts';

ruleTester.run('no-real-network-in-unit-tests', noRealNetworkInUnitTestsRule, {
  valid: [
    // Not a test file.
    { filename: 'src/api/client.ts', code: "await fetch('https://example.com');" },
    // Integration and e2e files may hit the network.
    { filename: 'src/api/client.integration.test.ts', code: "await fetch('https://example.com');" },
    { filename: 'test/app.e2e-spec.ts', code: "await fetch('http://localhost:3000');" },
    { filename: 'tests/integration/client.test.ts', code: "await axios.get('/x');" },
    // A local test double named `fetch` is not the network.
    {
      filename: unit,
      code: "const fetch = vi.fn(); await fetch('/x');",
    },
    // Globals swapped for doubles.
    { filename: unit, code: "vi.stubGlobal('fetch', vi.fn()); await fetch('/x');" },
    { filename: unit, code: "jest.spyOn(globalThis, 'fetch'); await fetch('/x');" },
    { filename: unit, code: "global.fetch = jest.fn(); await fetch('/x');" },
    // Mocked modules.
    { filename: unit, code: "import axios from 'axios'; vi.mock('axios'); await axios.get('/x');" },
    {
      filename: unit,
      code: "import fetch from 'node-fetch'; jest.mock('node-fetch'); await fetch('/x');",
    },
    // A method that merely shares a name.
    { filename: unit, code: "await repository.fetch(1); await store.get('k');" },
    // Configured: a custom integration marker.
    {
      filename: 'src/api/client.live.test.ts',
      code: "await fetch('https://example.com');",
      options: [{ integrationMarkers: ['.live.'] }],
    },
  ],
  invalid: [
    {
      filename: unit,
      code: "await fetch('https://example.com');",
      errors: [{ messageId: 'realNetworkInUnitTest', data: { callee: 'fetch' } }],
    },
    {
      filename: unit,
      code: "await globalThis.fetch('https://example.com');",
      errors: [{ messageId: 'realNetworkInUnitTest', data: { callee: 'fetch' } }],
    },
    {
      filename: unit,
      code: "import axios from 'axios'; await axios.post('/x', {}); await axios({ url: '/y' });",
      errors: [
        { messageId: 'realNetworkInUnitTest', data: { callee: 'axios.post' } },
        { messageId: 'realNetworkInUnitTest', data: { callee: 'axios' } },
      ],
    },
    // An imported real client is still the network.
    {
      filename: unit,
      code: "import fetch from 'node-fetch'; await fetch('/x');",
      errors: [{ messageId: 'realNetworkInUnitTest' }],
    },
    // Mocking an unrelated module does not help.
    {
      filename: unit,
      code: "vi.mock('./db'); await fetch('/x');",
      errors: [{ messageId: 'realNetworkInUnitTest' }],
    },
    // Configured: extra network callee and client.
    {
      filename: 'src/web/page.spec.tsx',
      code: "import ky from 'ky'; await ky.get('/x'); await request('/y');",
      options: [{ networkCallees: ['request'], httpClients: ['ky'] }],
      errors: [
        { messageId: 'realNetworkInUnitTest', data: { callee: 'ky.get' } },
        { messageId: 'realNetworkInUnitTest', data: { callee: 'request' } },
      ],
    },
  ],
});
