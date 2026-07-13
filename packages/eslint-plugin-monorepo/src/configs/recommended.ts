/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  // Ships OFF: this rule needs a `scopes` option to do anything (there is no
  // universal default scope), so `recommended` cannot safely turn it on for a
  // stranger's repo. Enable it explicitly with your own scopes, e.g.
  //   'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }]
  'noctcore-monorepo/no-deep-package-imports': 'off',
} as const;
