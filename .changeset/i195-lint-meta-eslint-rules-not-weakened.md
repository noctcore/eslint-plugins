---
'@noctcore/lint-meta-rules': minor
---

Add the `eslint-rules-not-weakened` rule and its factory `createEslintRulesNotWeakenedRule`, exported from `@noctcore/lint-meta-rules/resolved-config` beside `eslint-config-no-warn`. It takes a `pinned` map of rule id to the minimum the rule must hold, as a severity (`'error'`) or a severity plus option keys that must match (`['error', { assertionStyle: 'never' }]`), resolves each package's effective flat config per probe file through ESLint, and reports a pinned rule that is absent, off, below its pinned severity, or carries a different value for a pinned option key. Option keys the pin does not list are free. Because it reads the resolved config, it catches a spread preset or a later override block that weakens a pin, which a text scan of the config cannot see. `exemptProbes` (globs over the probe paths, such as `**/*.test.ts`) skips file shapes that relax a rule on purpose, and `packages`, `configFiles`, `probes` and `ciCritical` share the defaults of `eslint-config-no-warn`. Like that rule it fails closed when a config cannot be resolved, and it needs the optional `eslint` peer.

The factory is not part of `RULE_FACTORIES` or `createAllRules()`, and it does nothing without `pinned`, so no existing caller sees new violations. lint-meta has no `recommended` preset.
