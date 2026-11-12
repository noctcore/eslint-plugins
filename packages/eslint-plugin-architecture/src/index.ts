import { recommended } from './configs/recommended';
import { strict } from './configs/strict';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-architecture/<rule>`. */
const NAMESPACE = 'noctcore-architecture';
const VERSION = '1.1.0';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-architecture', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [architecture.configs.recommended]`.
plugin.configs.recommended = {
  // Shown by the ESLint config inspector and in config error messages.
  name: `${NAMESPACE}/recommended`,
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

// `recommended` plus the house rules: naming, folder shape and size caps.
plugin.configs.strict = {
  name: `${NAMESPACE}/strict`,
  plugins: { [NAMESPACE]: plugin },
  rules: strict,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
