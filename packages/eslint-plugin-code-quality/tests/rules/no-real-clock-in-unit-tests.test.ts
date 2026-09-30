import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRealClockInUnitTestsRule } from '../../src/rules/no-real-clock-in-unit-tests';

const SPEC = 'src/modules/auth/services/token.service.spec.ts';

ruleTester.run('no-real-clock-in-unit-tests', noRealClockInUnitTestsRule, {
  valid: [
    // Settly shapes: an offset from now is robust against the real clock.
    { code: 'const future = () => new Date(Date.now() + 60_000);', filename: SPEC },
    { code: 'const pastDate = new Date(Date.now() - 60_000);', filename: SPEC },
    {
      code: 'const row = { lockedUntil: new Date(Date.now() - LOCKOUT_QUIET_PERIOD_MS - MINUTE) };',
      filename: SPEC,
    },
    { code: 'const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);', filename: SPEC },
    { code: 'const later = new Date().getTime() + 1000;', filename: SPEC },
    { code: 'const earlier = +new Date() - 1000;', filename: SPEC },
    // A fixed date is not the real clock.
    { code: "const createdAt = new Date('2026-01-15T10:00:00Z');", filename: SPEC },
    // The file fakes the clock.
    {
      code: `
        beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15')); });
        afterEach(() => vi.useRealTimers());
        it('stamps', () => { expect(stamp().at).toEqual(new Date()); });
      `,
      filename: SPEC,
    },
    { code: "jest.spyOn(Date, 'now').mockReturnValue(1_000); const t = Date.now();", filename: SPEC },
    { code: "vi.spyOn(globalThis, 'Date'); const d = new Date();", filename: SPEC },
    { code: 'Date.now = () => 0; const t = Date.now();', filename: SPEC },
    // A stubbed or replaced global Date fakes the clock.
    { code: "vi.stubGlobal('Date', FakeDate); const d = new Date();", filename: SPEC },
    { code: "jest.replaceProperty(global, 'Date', FakeDate); const d = new Date();", filename: SPEC },
    // Settly shape: the file mocks the project's clock module.
    {
      code: `
        jest.mock('../../../common/clock', () => ({ nowMs: () => 1_000 }));
        const row = { deletedAt: new Date() };
      `,
      filename: SPEC,
      options: [{ clockModules: ['**/common/clock'] }],
    },
    // Not a unit test file, or an integration suite.
    { code: 'const now = new Date();', filename: 'src/modules/auth/services/token.service.ts' },
    { code: 'const now = new Date();', filename: 'src/modules/mail/email.integration.spec.ts' },
    // performance.now() measures a duration and is left alone.
    { code: 'const began = performance.now();', filename: SPEC },
  ],
  invalid: [
    // Settly shape: an exact-now fixture.
    {
      code: 'const row = { expiresAt: new Date() };',
      filename: 'src/modules/auth/services/auth-shared.service.spec.ts',
      errors: [{ messageId: 'realClockInUnitTest', data: { call: 'new Date()' } }],
    },
    {
      code: "repository.findInviteCandidate.mockResolvedValue({ ...CANDIDATE, deletedAt: new Date() });",
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    // Settly shape: a bare Date.now() start mark.
    {
      code: 'const started = Date.now();',
      filename: 'src/common/redis/redis-client.spec.ts',
      errors: [{ messageId: 'realClockInUnitTest', data: { call: 'Date.now()' } }],
    },
    // Settly shape: a stale blob built from now; only the bare call is reported.
    {
      code: 'const blob = { lastActive: Date.now(), stale: Date.now() - 5 * 60 * 1000 };',
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    // A comparison is not an offset.
    {
      code: 'while (Date.now() < deadline) { await tick(); }',
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    { code: 'const label = Date();', filename: SPEC, errors: [{ messageId: 'realClockInUnitTest', data: { call: 'Date()' } }] },
    { code: 'const iso = new Date().toISOString();', filename: SPEC, errors: [{ messageId: 'realClockInUnitTest' }] },
    // A mocked module that is not a configured clock module does not count.
    {
      code: "jest.mock('../../../common/clock'); const at = new Date();",
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    // Stubbing another global does not fake the clock.
    {
      code: "vi.stubGlobal('fetch', vi.fn()); const at = new Date();",
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    // Spying on something else does not fake the clock.
    {
      code: "vi.spyOn(Date.prototype, 'toLocaleString'); const at = new Date();",
      filename: SPEC,
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
    // A custom fake-clock method list replaces the default one.
    {
      code: 'vi.useFakeTimers(); const at = new Date();',
      filename: SPEC,
      options: [{ fakeClockMethods: ['installClock'] }],
      errors: [{ messageId: 'realClockInUnitTest' }],
    },
  ],
});
