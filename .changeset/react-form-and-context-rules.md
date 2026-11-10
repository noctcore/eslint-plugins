---
'@noctcore/eslint-plugin-react': minor
---

Three new rules.

- `password-input-requires-autocomplete` (in `recommended` at `error`): a JSX element whose `type` can be `"password"` (a literal, either branch of a show/hide conditional, or a `const` holding one) must carry an `autoComplete` that names a purpose. A spread such as `{...field}` does not count, and a bare, empty, `{undefined}` or `{null}` value is reported like a missing one. Any explicit value, `"off"` included, satisfies it. **A project that spreads `recommended` can see new errors**: measured on four real React apps, it found one field (a masked API token with no `autoComplete`).
- `no-native-date-input` (opt-in, left out of `recommended`): reports `<input>` / `<Input>` with a literal `type` of `date`, `datetime-local`, `month` or `week`, which Chromium formats in the browser UI language regardless of `lang`. Options: `elementNames`, `types`, `replacement` (named in the message) and `allowIn`.
- `enforce-context-consumption` (opt-in, needs options): with a `contexts` registry of `{ hook, files, providedProps }`, reports a `*Props` member or a destructured `*Props` parameter property, in the registered files, whose name the context already supplies. Checks nothing without the registry.
