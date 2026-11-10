// Lints this repository with eslint-plugin-eslint-plugin and with its own
// published rules. The noctcore plugins load from their built `dist/`, the same
// files npm ships, so run `bun run build` before `bun run lint` (CI does).
import tsParser from '@typescript-eslint/parser';
import eslintPlugin from 'eslint-plugin-eslint-plugin';

const loadPlugin = (name) =>
  import(`./packages/eslint-plugin-${name}/dist/index.js`).then((module) => module.default);

const [codeQuality, contracts, asyncSafety, security, architecture] = await Promise.all(
  ['code-quality', 'contracts', 'async-safety', 'security', 'architecture'].map(loadPlugin),
);

const SOURCE = ['packages/*/src/**/*.ts', 'scripts/**/*.ts'];

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'site/**', '**/*.d.ts'],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  // Rule authoring checks: meta shape, message ids, fixable and suggestion flags.
  {
    files: ['packages/eslint-plugin-*/src/rules/**/*.ts'],
    ...eslintPlugin.configs['rules-recommended'],
  },
  {
    files: ['packages/eslint-plugin-*/src/rules/**/*.ts'],
    rules: {
      // Every rule is built with typescript-eslint's RuleCreator, which takes
      // `defaultOptions` as its own argument and merges them for the rule.
      // `meta.defaultOptions` is ESLint's native mechanism from 9.15 on, and the
      // plugins promise ESLint 9.0.0, which would ignore it.
      'eslint-plugin/require-meta-default-options': 'off',
    },
  },
  {
    files: ['packages/eslint-plugin-*/tests/rules/**/*.ts'],
    ...eslintPlugin.configs['tests-recommended'],
  },

  // The repo's own rules, from each plugin's `recommended` preset.
  { files: SOURCE, ...codeQuality.configs.recommended },
  { files: SOURCE, ...contracts.configs.recommended },
  { files: SOURCE, ...asyncSafety.configs.recommended },
  { files: SOURCE, ...security.configs.recommended },
  { files: SOURCE, ...architecture.configs.recommended },
  {
    files: SOURCE,
    rules: {
      // House naming conventions this repo does not follow: rule files are named
      // after the rule id, not the exported `<camelCase>Rule` binding.
      'noctcore-architecture/filename-matches-export': 'off',
      // Style, not correctness, and proposed for removal from `recommended`.
      'noctcore-code-quality/prefer-early-return': 'off',
    },
  },
  {
    // Package entry points build the plugin object (or the rule catalog) and
    // also re-export helpers for consumers' tooling; that mix is deliberate.
    files: ['packages/*/src/index.ts', 'packages/lint-meta-rules/src/rules/index.ts'],
    rules: {
      'noctcore-architecture/barrel-purity': 'off',
    },
  },
  {
    // The registry URL is the consumer's own option (a private registry), and
    // the ledger rule's default clock is the one place behind its `now` option.
    files: [
      'packages/lint-meta-rules/src/rules/noctcore-packages-current.ts',
      'packages/lint-meta-rules/src/rules/pnpm-override-ledger.ts',
    ],
    rules: {
      'noctcore-security/no-user-controlled-fetch-url': 'off',
      'noctcore-code-quality/no-bare-date-now': 'off',
    },
  },
  {
    // Test infrastructure reads its own switches from the environment and wires
    // `it.only` into RuleTester by assignment, which focuses nothing.
    files: ['packages/eslint-test-utils/src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'noctcore-contracts/no-direct-process-env': 'off',
      'noctcore-code-quality/no-focused-tests': 'off',
    },
  },
];
