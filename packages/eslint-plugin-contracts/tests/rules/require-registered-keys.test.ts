import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireRegisteredKeysRule } from '../../src/rules/require-registered-keys';

const FILE = 'src/store.ts';

const SINKS = [
  { callee: 'localStorage.getItem', argIndex: 0 },
  { callee: 'emitter.on', argIndex: 0 },
] as const;

const options = [{ sinks: SINKS, registry: '@/keys' }] as const;

ruleTester.run('require-registered-keys', requireRegisteredKeysRule, {
  valid: [
    // Inert until configured.
    {
      code: `localStorage.getItem('user-profile');`,
      filename: FILE,
      options: [{}],
    },
    // Imported constant (identifier) is exactly what we want.
    {
      code: `localStorage.getItem(USER_PROFILE_KEY);`,
      filename: FILE,
      options,
    },
    // Non-configured callee is not policed.
    {
      code: `sessionStorage.getItem('user-profile');`,
      filename: FILE,
      options,
    },
    // Constant in the policed position of a configured event sink.
    {
      code: `emitter.on(TASK_DONE, handler);`,
      filename: FILE,
      options,
    },
    // Template literal is dynamic, not the raw-string smell.
    {
      code: 'localStorage.getItem(`user-${id}`);',
      filename: FILE,
      options,
    },
  ],
  invalid: [
    // Raw string key into a configured storage sink.
    {
      code: `localStorage.getItem('user-profile');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unregisteredKey' }],
    },
    // Raw string channel into a configured event sink.
    {
      code: `emitter.on('task-done', handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unregisteredKey' }],
    },
    // No registry option: still flagged, message just omits the import hint.
    {
      code: `flags.isEnabled('new-ui');`,
      filename: FILE,
      options: [{ sinks: [{ callee: 'flags.isEnabled', argIndex: 0 }] }],
      errors: [{ messageId: 'unregisteredKey' }],
    },
  ],
});
