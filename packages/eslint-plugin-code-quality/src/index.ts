import { recommended } from './configs/recommended';
import { strict } from './configs/strict';
import { TEST_FILES, tests } from './configs/tests';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-code-quality/<rule>`. */
const NAMESPACE = 'noctcore-code-quality';
const VERSION = '0.4.2';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-code-quality', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [codeQuality.configs.recommended]`.
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

// The test-discipline rules alone, scoped to test files with `files` set, so a
// consumer does not hand-write test globs for them.
plugin.configs.tests = {
  name: `${NAMESPACE}/tests`,
  files: [...TEST_FILES],
  plugins: { [NAMESPACE]: plugin },
  rules: tests,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
