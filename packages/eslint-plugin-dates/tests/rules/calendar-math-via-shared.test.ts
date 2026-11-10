import { ruleTester } from '@noctcore/eslint-test-utils';

import { calendarMathViaSharedRule } from '../../src/rules/calendar-math-via-shared';

const WEB = 'apps/web/src/features/compliance/components/AgendaCalendar/AgendaCalendar.hooks.ts';
const HR = 'apps/api/src/modules/hr/ics/ics.util.ts';
const CALENDAR = 'packages/shared/src/constants/calendar.ts';
const ALLOW = { allowIn: ['**/packages/shared/src/constants/calendar.ts'] };

const HINT = 'Use a helper from your calendar module, or add the missing one there.';

ruleTester.run('calendar-math-via-shared', calendarMathViaSharedRule, {
  valid: [
    // The replacement: the shared helper, imported.
    {
      code: "import { addMonths } from '@repo/shared/constants'; const next = addMonths(start, 1);",
      filename: WEB,
      options: [ALLOW],
    },
    // The calendar module is the home.
    {
      code: 'export const DAY_MS = 86_400_000;\nexport const nextDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));',
      filename: CALENDAR,
      options: [ALLOW],
    },
    // A plain instant read is not calendar arithmetic.
    { code: 'const ms = value.getTime(); const iso = value.toISOString();', filename: HR },
    // `UTC` on anything but `Date` is some other API.
    { code: 'const zone = tz.UTC(); const m = moment.utc();', filename: WEB },
    // Durations that are not a day.
    { code: 'const HOUR = 60 * 60 * 1000; const WEEK_S = 7 * 24 * 60 * 60;', filename: WEB },
    { code: 'const timeoutMs = 30 * 1000; const big = 864_000_000;', filename: WEB },
    // A check that is switched off reports nothing.
    { code: 'const ttl = 24 * 60 * 60 * 1000;', filename: WEB, options: [{ checks: ['utcAccessor'] }] },
  ],
  invalid: [
    {
      // The ICS shape: a day key rebuilt by hand from parts.
      code: 'const n = new Date(Date.UTC(year, month - 1, day + 1));',
      filename: HR,
      options: [ALLOW],
      errors: [{ messageId: 'handRolledCalendarMath', data: { hint: HINT, call: 'Date.UTC()' } }],
    },
    {
      // A month key rebuilt from UTC getters.
      code: 'const key = `${value.getUTCFullYear()}-${value.getUTCMonth() + 1}`;',
      filename: WEB,
      errors: [
        { messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.getUTCFullYear()' } },
        { messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.getUTCMonth()' } },
      ],
    },
    {
      // UTC getters and setters on any receiver, through `?.` and a string key.
      code: "d.setUTCDate(1); const a = maybe?.getUTCDay(); const m = key['getUTCMonth']();",
      filename: WEB,
      errors: [
        { messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.setUTCDate()' } },
        { messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.getUTCDay()' } },
        { messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.getUTCMonth()' } },
      ],
    },
    {
      // Month arithmetic by setter overflows: 31 January plus one is 3 March.
      code: 'const next = new Date(start); next.setMonth(next.getMonth() + 1);',
      filename: HR,
      errors: [{ messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.setMonth()' } }],
    },
    {
      // A day in milliseconds, written out or as a product in any order.
      code: 'const tomorrow = new Date(now.getTime() + 86400000);',
      filename: WEB,
      errors: [{ messageId: 'msPerDay', data: { hint: HINT, text: '86400000' } }],
    },
    {
      code: 'const DAY = 24 * 60 * 60 * 1000;\nconst also = 1000 * 60 * 60 * 24;',
      filename: WEB,
      errors: [
        { messageId: 'msPerDay', line: 1, data: { hint: HINT, text: '24 * 60 * 60 * 1000' } },
        { messageId: 'msPerDay', line: 2, data: { hint: HINT, text: '1000 * 60 * 60 * 24' } },
      ],
    },
    {
      // Day counts multiplied into the product, reported once for the whole chain.
      code: 'const days = Math.round((end - start) / (1000 * 60 * 60 * 24));\nconst later = start + days * 86_400 * 1000;',
      filename: HR,
      errors: [
        { messageId: 'msPerDay', line: 1, data: { hint: HINT, text: '1000 * 60 * 60 * 24' } },
        { messageId: 'msPerDay', line: 2, data: { hint: HINT, text: 'days * 86_400 * 1000' } },
      ],
    },
    {
      // allowIn exempts only the paths it names.
      code: 'const d = key.getUTCDate();',
      filename: WEB,
      options: [ALLOW],
      errors: [{ messageId: 'handRolledCalendarMath', data: { hint: HINT, call: '.getUTCDate()' } }],
    },
    {
      // calendarModule names the fix in the message.
      code: 'const ms = 864e5;',
      filename: WEB,
      options: [{ calendarModule: '@acme/shared/calendar' }],
      errors: [
        {
          message:
            '`864e5` treats a day as 24 hours, which it is not on the two days a year clocks change. Add or compare calendar days through the calendar module. Use a helper from `@acme/shared/calendar`, or add the missing one there.',
        },
      ],
    },
  ],
});
