import { ruleTester } from '@noctcore/eslint-test-utils';

import { noLocalCalendarTimeRule } from '../../src/rules/no-local-calendar-time';

const WEB = 'apps/web/src/features/compliance/Compliance.state.ts';
const API = 'apps/api/src/modules/hr/contract/contract.service.ts';
const UI = 'packages/ui/src/components/date-field.tsx';
const CALENDAR = 'packages/shared/src/constants/calendar.ts';
const ALLOW = { allowIn: ['**/packages/shared/src/constants/calendar.ts'] };
const ALL_CHECKS = {
  checks: ['localAccessor', 'dateOnlyParse', 'isoDaySlice', 'instantVsNow'] as const,
};

const HINT = 'Use a helper from your calendar module, or add the missing one there.';

ruleTester.run('no-local-calendar-time', noLocalCalendarTimeRule, {
  valid: [
    // The replacement for a calendar day: a helper from the calendar module.
    { code: 'const overdue = isPastDue(item.dueAt, clock.now());', filename: WEB, options: [ALLOW] },
    // The calendar module itself, where the zone is read on purpose.
    { code: 'export const dayOf = (d: Date) => d.getDate();', filename: CALENDAR, options: [ALLOW] },
    // The UTC accessors are calendar-math-via-shared's business.
    { code: 'const day = key.getUTCDate() + key.getUTCMonth();', filename: WEB },
    // Not local accessors, even though the names start the same way.
    { code: 'const ms = value.getTime(); const offset = value.getTimezoneOffset();', filename: UI },
    // A full timestamp names its zone; a date-time string is not a date-only one.
    { code: "const at = new Date('2026-03-31T08:00:00Z');", filename: API },
    { code: "const at = Date.parse('2026-03-31T00:00:00+02:00');", filename: API },
    // A date-only string that is not parsed.
    { code: "const label = '2026-03-31';", filename: WEB },
    // Year, month and day parts: the local constructor is a different shape.
    { code: 'const d = new Date(2026, 2, 31);', filename: WEB },
    // `toISOString()` kept whole, or cut somewhere other than the day.
    { code: 'const stamp = now.toISOString();', filename: API },
    { code: 'const time = now.toISOString().slice(11, 19);', filename: API },
    { code: "const first = line.split('T')[0];", filename: API },
    // instantVsNow is off by default: it is right for a token expiry.
    { code: 'const expired = token.expiresAt.getTime() < Date.now();', filename: API },
    // With it on, two instants compared explicitly, equality, and arithmetic.
    { code: 'const expired = token.expiresAt.getTime() <= now.getTime();', filename: API, options: [ALL_CHECKS] },
    { code: 'const same = stamp.getTime() === Date.now();', filename: API, options: [ALL_CHECKS] },
    { code: 'const age = Date.now() - createdAt.getTime();', filename: API, options: [ALL_CHECKS] },
    // A check that is switched off reports nothing.
    { code: 'const h = instant.getHours();', filename: API, options: [{ checks: ['isoDaySlice'] }] },
  ],
  invalid: [
    {
      // A local end-of-day on a day stored as midnight UTC.
      code: 'const copy = new Date(to); copy.setHours(23, 59, 59, 999);',
      filename: WEB,
      options: [ALLOW],
      errors: [{ messageId: 'localAccessor', data: { hint: HINT, method: 'setHours' } }],
    },
    {
      // Every local getter, one report each.
      code: 'const p = [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes()];',
      filename: API,
      errors: [
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getFullYear' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getMonth' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getDate' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getDay' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getHours' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getMinutes' } },
      ],
    },
    {
      // Every local setter.
      code: 'd.setFullYear(2026); d.setMonth(0); d.setDate(1); d.setHours(0); d.setMinutes(0);',
      filename: UI,
      errors: [
        { messageId: 'localAccessor', data: { hint: HINT, method: 'setFullYear' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'setMonth' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'setDate' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'setHours' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'setMinutes' } },
      ],
    },
    {
      // Any receiver, an optional call and a string key.
      code: "const y = new Date().getFullYear(); const m = maybe?.getMonth(); const x = d['getDay']();",
      filename: WEB,
      errors: [
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getFullYear' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getMonth' } },
        { messageId: 'localAccessor', data: { hint: HINT, method: 'getDay' } },
      ],
    },
    {
      // A date-only string parsed as midnight UTC, then read locally west of UTC.
      code: "const due = new Date('2026-03-31');",
      filename: WEB,
      errors: [{ messageId: 'dateOnlyParse', data: { hint: HINT, text: "new Date('2026-03-31')" } }],
    },
    {
      code: 'const ms = Date.parse(`2026-03-31`);',
      filename: API,
      errors: [{ messageId: 'dateOnlyParse' }],
    },
    {
      // "Today" as the UTC day of now: yesterday in Warsaw just after midnight.
      code: 'const today = new Date().toISOString().slice(0, 10);',
      filename: WEB,
      errors: [{ messageId: 'isoDaySlice' }],
    },
    {
      code: "const a = at.toISOString().substring(0, 10); const b = at.toISOString().split('T')[0];",
      filename: API,
      errors: [{ messageId: 'isoDaySlice' }, { messageId: 'isoDaySlice' }],
    },
    {
      // Through optional chaining and a non-null assertion.
      code: 'const key = row?.createdAt!.toISOString().slice(0, 10);',
      filename: API,
      errors: [{ messageId: 'isoDaySlice' }],
    },
    {
      // The shape that turned a deadline overdue on its own last day.
      code: 'const overdue = item.dueAt.getTime() < Date.now();',
      filename: WEB,
      options: [ALL_CHECKS],
      errors: [{ messageId: 'instantVsNow' }],
    },
    {
      // Either order, every ordering operator.
      code: 'const a = d.getTime() > Date.now(); const b = Date.now() >= d.getTime();',
      filename: UI,
      options: [ALL_CHECKS],
      errors: [{ messageId: 'instantVsNow' }, { messageId: 'instantVsNow' }],
    },
    {
      // allowIn exempts only the paths it names.
      code: 'const h = instant.getHours();',
      filename: API,
      options: [ALLOW],
      errors: [{ messageId: 'localAccessor', data: { hint: HINT, method: 'getHours' } }],
    },
    {
      // calendarModule names the fix in the message.
      code: 'const d = due.getDate();',
      filename: WEB,
      options: [{ calendarModule: '@acme/shared/calendar' }],
      errors: [
        {
          message:
            "`getDate()` reads the machine's time zone, so the same stored day is a different date on a server or in a browser in another zone. Use a helper from `@acme/shared/calendar`, or add the missing one there.",
        },
      ],
    },
  ],
});
