/**
 * `@noctcore/lint-meta-rules/i18n`: whole-program translation checks.
 *
 * A separate entry point because, unlike the main catalog, these rules run
 * ESLint's parser and scope analysis (they reuse the i18n visitor behind
 * `noctcore-contracts/translation-key-exists`). Importing the main entry never
 * loads ESLint; importing this one needs the optional peers `eslint` and
 * `@typescript-eslint/parser`.
 */
export {
  createTranslationDeadKeysRule,
  deriveNamespaces,
  type TranslationDeadKeysOptions,
} from './i18n/translation-dead-keys';
