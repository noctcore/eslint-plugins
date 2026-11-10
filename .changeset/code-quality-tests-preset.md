---
'@noctcore/eslint-plugin-code-quality': minor
---

New preset `configs.tests`: the test-discipline rules of `recommended` (`no-focused-tests`, `skipped-tests-need-tracking`, `no-vacuous-expect`, `no-conditional-expect`, `no-swallowed-assertion`, `fake-timers-must-be-restored`, `no-real-network-in-unit-tests`) with `files` set to `**/*.{test,spec}.*` and `**/__tests__/**` in every JS and TS extension, so a project scopes the test rules without hand-written globs:

```js
export default [{ ...codeQuality.configs.tests, languageOptions: { parser: tsParser } }];
```

`recommended` and `strict` are unchanged; a project that spreads `recommended` sees no difference.
