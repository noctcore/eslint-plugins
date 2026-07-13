/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  // Ships OFF: this rule needs a `scopes` option to do anything (there is no
  // universal default scope), so `recommended` cannot safely turn it on for a
  // stranger's repo. Enable it explicitly with your own scopes, e.g.
  //   'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }]
  'noctcore-monorepo/no-deep-package-imports': 'off',
  // Ships OFF for the same reason — `scopes` is required, so the rule cannot be
  // turned on in a shared preset. Enable it with your own scopes, e.g.
  //   'noctcore-monorepo/no-unexported-subpath-import': ['error', { scopes: ['@acme'] }]
  'noctcore-monorepo/no-unexported-subpath-import': 'off',
} as const;
