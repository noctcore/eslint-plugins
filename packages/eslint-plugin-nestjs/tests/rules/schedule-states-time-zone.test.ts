import { ruleTester } from '@noctcore/eslint-test-utils';

import { scheduleStatesTimeZoneRule } from '../../src/rules/schedule-states-time-zone';

const cron = (options: string): string =>
  `class Sweep {\n  @Cron(CronExpression.EVERY_DAY_AT_3AM${options})\n  run() {}\n}\n`;

const SETTLY_ZONES = [{ zones: ['UTC', 'Europe/Warsaw'] }];

ruleTester.run('schedule-states-time-zone', scheduleStatesTimeZoneRule, {
  valid: [
    { code: cron(", { name: 'sweep', timeZone: 'UTC' }") },
    { code: cron(", { name: 'sweep', timeZone: 'Europe/Warsaw' }") },
    // Without `zones`, a constant states the zone too.
    { code: cron(', { timeZone: APP_TIME_ZONE }') },
    { code: cron(', { utcOffset: 0 }') },
    { code: `queue.upsertJobScheduler('id', { pattern: '0 3 * * *', tz: 'UTC' }, t);` },
    { code: `this.queue.upsertJobScheduler('id', { pattern: P, tz: 'Europe/Warsaw' }, t);` },
    // An interval has no wall-clock hour.
    { code: `queue.upsertJobScheduler('id', { every: 60_000 }, t);` },
    { code: `queue.add('n', d, { repeat: { every: 60_000 } });` },
    { code: `queue.add('n', d, { repeat: { pattern: '0 3 * * *', tz: 'UTC' } });` },
    { code: `queue.add('n', d, { jobId });` },
    // Not a schedule.
    { code: `class A {\n  @Get('x')\n  run() {}\n}\n` },
    // The zones the options allow.
    { code: cron(", { timeZone: 'Europe/Warsaw' }"), options: SETTLY_ZONES },
    { code: cron(", { timeZone: 'America/New_York' }"), options: [{ zones: ['America/New_York'] }] },
  ],
  invalid: [
    { code: cron(''), errors: [{ messageId: 'cronZone', line: 2 }] },
    { code: cron(", { name: 'sweep' }"), errors: [{ messageId: 'cronZone' }] },
    { code: cron(', { timeZone: undefined }'), errors: [{ messageId: 'cronZone' }] },
    { code: cron(", { meta: { timeZone: 'UTC' } }"), errors: [{ messageId: 'cronZone' }] },
    { code: cron(', options'), errors: [{ messageId: 'cronZone' }] },
    // With `zones`, only those literals pass.
    { code: cron(", { timeZone: 'Not/AZone' }"), options: SETTLY_ZONES, errors: [{ messageId: 'cronZone' }] },
    { code: cron(', { timeZone: ZONE }'), options: SETTLY_ZONES, errors: [{ messageId: 'cronZone' }] },
    { code: cron(', { utcOffset: 0 }'), options: SETTLY_ZONES, errors: [{ messageId: 'cronZone' }] },
    {
      code: `queue.upsertJobScheduler('id', { pattern: '0 3 * * *' }, t);`,
      errors: [{ messageId: 'schedulerZone' }],
    },
    {
      code: `queue.upsertJobScheduler('id', { pattern: 'p', tz: undefined }, t);`,
      errors: [{ messageId: 'schedulerZone' }],
    },
    {
      code: `queue.upsertJobScheduler('id', { pattern: 'p', tz: ZONE }, t);`,
      options: SETTLY_ZONES,
      errors: [{ messageId: 'schedulerZone' }],
    },
    {
      code: `queue.upsertJobScheduler('id', { every: undefined, pattern: 'p' }, t);`,
      errors: [{ messageId: 'schedulerZone' }],
    },
    { code: `queue.upsertJobScheduler('id', spec, t);`, errors: [{ messageId: 'schedulerZone' }] },
    {
      code: `this.reportsQueue.add('n', d, { repeat: { pattern: '0 3 * * *' } });`,
      errors: [{ messageId: 'repeatZone' }],
    },
  ],
});
