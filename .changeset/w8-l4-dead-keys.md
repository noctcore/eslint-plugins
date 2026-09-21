---
"@noctcore/lint-meta-rules": minor
"@noctcore/eslint-plugin-contracts": minor
---

New: `createTranslationDeadKeysRule`, a whole-program dead translation-key check, on a new entry
point `@noctcore/lint-meta-rules/i18n`.

Dead-key detection cannot be sound as an ESLint rule: a per-file rule never sees every call site, and
keys flow as data. This lint-meta factory walks every configured source file once, resolves call
sites with the same visitor and catalog loader as `noctcore-contracts/translation-key-exists`, and
also counts every string literal, template literal and `+` chain in the source as a possible key. It
reports only keys that no call names and no string spells, and it reports no dead key at all when a
source file cannot be analysed. Configure it with catalog locations and source globs; there are no
built-in paths. Blind spots are listed in `docs/rules/translation-dead-keys.md`.

The main entry point is unchanged and still never loads ESLint. The `i18n` entry needs the optional
peers `eslint` (>= 9) and `@typescript-eslint/parser`.

`@noctcore/eslint-plugin-contracts` now exports the i18n building blocks behind
`translation-key-exists` (`createTranslationVisitor`, `catalogsForNamespace`, `catalogHasKey`,
`catalogHasPrefix`, `translationSettingsOf`, `TRANSLATION_DEFAULTS` and their types), so the two
checks share one implementation. Export-only: no rule behaviour changes.
