---
'@noctcore/lint-meta-rules': minor
---

Six repo-hygiene rules:

- `github-actions-timeout-required`: every workflow job that runs steps declares a job-level `timeout-minutes` (reusable-workflow calls are exempt).
- `eslint-override-paths-exist`: literal `files` and one-file `ignores` paths in an ESLint flat config, and the directory each `files` glob starts in, exist relative to that config.
- `tsconfig-include-paths-exist`: literal `include` and `files` entries in a tsconfig, and the directory each glob entry starts in, exist relative to that config.
- On the new `@noctcore/lint-meta-rules/typescript` entry point (optional peer `typescript`):
  - `no-inline-lint-disable`: no inline `eslint-disable` directive in hand-written source, read through the TypeScript parser so strings, templates, regex literals and JSX text are never mistaken for comments; generated files are skipped, and `allowWithDescription` lets a reasoned directive through.
  - `no-ts-ignore`: no `@ts-ignore` (and, unless `allowExpectError`, no `@ts-expect-error`) in any comment form tsc honours.
  - `test-file-matches-runner-include`: every test file is collected by a Vitest, Jest, Bun or Playwright runner that covers its directory; configs the rule cannot read are left alone.
