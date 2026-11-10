---
'@noctcore/eslint-plugin-code-quality': patch
---

`no-vacuous-expect`, `no-message-only-throw-assertion` and `typed-mock-over-double-cast` match callees through the shared `@noctcore/eslint-utils` helpers. A member chain rooted at an identifier is now matched by its full dotted path, so `assert.strict.equal(...)` counts as an assertion under the default `^assert`, and a configured `testing.mocks.fn` or `helpers.errors.expectRejects` matches. A member call on anything else is still matched as `.name`.
