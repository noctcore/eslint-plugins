import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-electron/<rule>`. */
const NAMESPACE = 'noctcore-electron';
const VERSION = '0.1.0';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-electron', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [electron.configs.recommended]`.
plugin.configs.recommended = {
  // Shown by the ESLint config inspector and in config error messages.
  name: `${NAMESPACE}/recommended`,
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
