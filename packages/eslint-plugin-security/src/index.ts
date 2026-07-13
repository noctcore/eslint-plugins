import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-security/<rule>`. */
const NAMESPACE = 'noctcore-security';
const VERSION = '0.1.0';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-security', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [security.configs.recommended]`.
plugin.configs.recommended = {
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
