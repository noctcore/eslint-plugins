import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { fakeTimersMustBeRestoredRule } from '../../src/rules/fake-timers-must-be-restored';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/fake-timers');
const specInFixtures = path.join(fixtures, 'clock.contract.spec.ts');

ruleTester.run('fake-timers-must-be-restored', fakeTimersMustBeRestoredRule, {
  valid: [
    { code: "it('no timers', () => {});" },
    {
      code: `
        beforeEach(() => { jest.useFakeTimers(); });
        afterEach(() => { jest.useRealTimers(); });
      `,
    },
    {
      code: `
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());
      `,
    },
    // Shared-suite pattern: the spec fakes timers, the imported suite it runs
    // restores them in its own afterEach.
    {
      filename: specInFixtures,
      code: `
        import { runClockSuite } from './timer-suite';
        const advance = () => { jest.useFakeTimers(); jest.setSystemTime(0); };
        runClockSuite({ tick: advance });
      `,
    },
    // Suite resolved through a directory index.
    {
      filename: specInFixtures,
      code: `
        import { runNestedSuite } from './nested';
        beforeEach(() => vi.useFakeTimers());
        runNestedSuite();
      `,
    },
    // A non-relative suite module declared through `sharedSuiteModules`.
    {
      code: `
        import { runProviderContract } from '@acme/testing/provider-suite';
        beforeEach(() => jest.useFakeTimers());
        runProviderContract();
      `,
      options: [{ sharedSuiteModules: ['@acme/testing/*-suite'] }],
    },
    // Custom method names.
    {
      code: `
        beforeEach(() => clock.install());
        afterEach(() => clock.uninstall());
      `,
      options: [{ fakeTimerMethods: ['install'], restoreTimerMethods: ['uninstall'] }],
    },
  ],
  invalid: [
    {
      code: "beforeEach(() => { jest.useFakeTimers(); });\nit('x', () => {});",
      errors: [{ messageId: 'timersNotRestored', data: { method: 'useFakeTimers' } }],
    },
    {
      code: 'vi.useFakeTimers();\nvi.useFakeTimers({ now: 0 });',
      errors: [{ messageId: 'timersNotRestored' }, { messageId: 'timersNotRestored' }],
    },
    // Importing a module that does not restore is not an excuse.
    {
      filename: specInFixtures,
      code: `
        import { makeSubject } from './plain-helpers';
        beforeEach(() => jest.useFakeTimers());
        makeSubject();
      `,
      errors: [{ messageId: 'timersNotRestored' }],
    },
    // The suite restores, but this file only imports it without running it.
    {
      filename: specInFixtures,
      code: `
        import { runClockSuite } from './timer-suite';
        beforeEach(() => jest.useFakeTimers());
        export { runClockSuite };
      `,
      errors: [{ messageId: 'timersNotRestored' }],
    },
    // Suite following disabled: the shared-suite restore is no longer seen.
    {
      filename: specInFixtures,
      code: `
        import { runClockSuite } from './timer-suite';
        beforeEach(() => jest.useFakeTimers());
        runClockSuite({ tick: () => undefined });
      `,
      options: [{ followImportedSuites: false }],
      errors: [{ messageId: 'timersNotRestored' }],
    },
    // Custom fake method with the default restore absent.
    {
      code: 'beforeEach(() => clock.install());',
      options: [{ fakeTimerMethods: ['install'] }],
      errors: [{ messageId: 'timersNotRestored', data: { method: 'install' } }],
    },
  ],
});
