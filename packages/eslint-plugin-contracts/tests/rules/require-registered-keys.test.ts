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
    // A one-segment sink matches only a bare call, never a method of that name.
    {
      code: `cache.set('user-profile', value);`,
      filename: FILE,
      options: [{ sinks: [{ callee: 'set', argIndex: 0 }] }],
    },
    // A suffix must end at the method: redis.set does not cover redis.settings.
    {
      code: `this.redis.settings('user-profile');`,
      filename: FILE,
      options: [{ sinks: [{ callee: 'redis.set', argIndex: 0 }] }],
    },
  ],
  invalid: [
    // A NestJS service sink rooted at this.
    {
      code: `class S { save(v) { return this.redis.set('user-profile', v); } }`,
      filename: FILE,
      options: [{ sinks: [{ callee: 'redis.set', argIndex: 0 }] }],
      errors: [{ messageId: 'unregisteredKey', data: { callee: 'redis.set', value: "'user-profile'", registryHint: '' } }],
    },
    // A sink path may name this explicitly.
    {
      code: `class S { save(v) { return this.store.set('theme', v); } }`,
      filename: FILE,
      options: [{ sinks: [{ callee: 'this.store.set', argIndex: 0 }] }],
      errors: [{ messageId: 'unregisteredKey' }],
    },
    // A dotted suffix match through a longer chain.
    {
      code: `window.localStorage.getItem('user-profile');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unregisteredKey' }],
    },
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
