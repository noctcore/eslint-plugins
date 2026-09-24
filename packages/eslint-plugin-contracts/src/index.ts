import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-contracts/<rule>`. */
const NAMESPACE = 'noctcore-contracts';
const VERSION = '0.7.1';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-contracts', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [contracts.configs.recommended]`.
plugin.configs.recommended = {
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

export { rules };
export const configs = plugin.configs;
export default plugin;

// The i18n building blocks behind `translation-key-exists`, exported so a
// whole-program check (the dead-key factory in `@noctcore/lint-meta-rules`)
// resolves keys and loads catalogs exactly as the rule does, instead of keeping
// a second implementation that drifts.
export {
  createTranslationVisitor,
  type TranslationSettings,
  type TranslationUsage,
} from './i18n/translationUsage';
export {
  type Catalog,
  type CatalogSource,
  catalogHasKey,
  catalogHasPrefix,
  catalogsForNamespace,
  type KeyLookup,
  type NamespaceCatalogs,
} from './i18n/catalogs';
export {
  TRANSLATION_DEFAULTS,
  type TranslationKeyExistsOptions,
  translationSettingsOf,
} from './rules/translation-key-exists';
