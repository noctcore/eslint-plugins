---
'@noctcore/eslint-plugin-dates': minor
---

New package `@noctcore/eslint-plugin-dates` for calendar days stored as `Date`s, starting at 0.1.0 with two opt-in rules (the `recommended` preset is empty: both need `allowIn` to name your calendar module):

- `no-local-calendar-time`: local `Date` accessors and setters (`getDate()`, `setHours()`), `new Date('YYYY-MM-DD')` and `Date.parse('YYYY-MM-DD')`, and `toISOString().slice(0, 10)` (or `.split('T')[0]`); `getTime()` compared with `Date.now()` through `checks: ['instantVsNow']`.
- `calendar-math-via-shared`: `getUTC*` / `setUTC*`, `Date.UTC()`, `setMonth`, and a day in milliseconds (`86400000`, `24 * 60 * 60 * 1000` in any order) outside the calendar module.
