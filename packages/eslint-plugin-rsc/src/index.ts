import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-rsc/<rule>`. */
const NAMESPACE = 'noctcore-rsc';
const VERSION = '0.1.2';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-rsc', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [rsc.configs.recommended]`.
plugin.configs.recommended = {
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
