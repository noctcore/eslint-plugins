import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-llm/<rule>`. */
const NAMESPACE = 'noctcore-llm';
const VERSION = '0.1.2';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-llm', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [llm.configs.recommended]`.
plugin.configs.recommended = {
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
