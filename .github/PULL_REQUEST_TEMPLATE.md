<!-- Keep this short. CONTRIBUTING.md has the long version. -->

## What

<!-- One or two sentences. For a rule: what it flags, what it deliberately leaves alone. -->

## Checklist

- [ ] A changeset in `.changeset/` (`bun run changeset`), written for a consumer reading the changelog, that says whether a project spreading `recommended` will see new errors. Skip only if no published package changed.
- [ ] Tests: `bun run build && bun run typecheck && bun run test` is green locally (`test` runs on ESLint 10 and then 9).
- [ ] Rule doc examples: every `ts`/`tsx` fence in `docs/rules/<rule>.md` is labelled `bad`, `good` or `prose`, and I ran them (`bunx vitest run tests/docs/plugins.test.ts -t <rule>` in `packages/eslint-test-utils`).
- [ ] If a rule was added or removed: `EXPECTED_RULE_COUNT` in `site/scripts/parity.test.ts` is updated, `bun run docs:readmes` has regenerated the README table and doc header, and the preset either lists the rule at `error` or names it in `OMITTED_FROM_PRESETS` with a reason.
