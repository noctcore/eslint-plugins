import { calendarMathViaSharedRule } from './calendar-math-via-shared';
import { noLocalCalendarTimeRule } from './no-local-calendar-time';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'calendar-math-via-shared': calendarMathViaSharedRule,
  'no-local-calendar-time': noLocalCalendarTimeRule,
};
