# Contributing

Thanks for looking. This file is mostly about the one path that is not obvious here: adding or
changing a rule. Every step below was taken from the tree as it is today, not from how ESLint
repos usually work, and the tree is the authority if the two ever disagree.

If you only want to report something, skip to [Reporting](#reporting): the issue forms ask for
exactly what is needed to act.

## Setup and the commands that matter

Requirements: [Bun](https://bun.sh) 1.3.14 (`packageManager` in the root `package.json`) and
Node 22 or newer (`engines`; the docs site needs 22.12 or newer).

```sh
bun install
bun run build        # first, always: see below
bun run typecheck
bun run test         # every package, on ESLint 10 and then on ESLint 9
bun run docs:build   # the docs site, plus its post-build checks
```

**Build before you typecheck.** Every plugin imports `@noctcore/eslint-utils`, and TypeScript
resolves that package through its emitted `dist/index.d.ts`. In a fresh clone, or after
`rm -rf packages/*/dist`, `tsc` fails with `Cannot find module '@noctcore/eslint-utils'` and then
reports an implicit `any` in every rule. That is not a bug in your code. Run `bun run build`
and the errors go away. CI does the same thing, in that order (`.github/workflows/ci.yml`).

**`bun run test` runs twice.** It is `test:eslint10 && test:eslint9`. The second leg sets
`NODE_OPTIONS=--import=@noctcore/eslint-test-utils/eslint9`, a Node resolve hook that redirects
every `eslint` import to `eslint@9.0.0`, the floor of the `eslint >=9.0.0` peer range each plugin
declares. A rule that only works on ESLint 10 fails there, which is the point.

For a tighter loop while you work on one rule:

```sh
cd packages/eslint-plugin-security
bunx vitest run tests/rules/no-shell-interpolation.test.ts       # one rule, ESLint 10
NODE_OPTIONS=--import=@noctcore/eslint-test-utils/eslint9 \
  bunx vitest run tests/rules/no-shell-interpolation.test.ts     # same, ESLint 9

cd packages/eslint-test-utils
bunx vitest run tests/docs/plugins.test.ts -t no-shell-interpolation   # that rule's doc examples

cd site
bun test scripts                                                # the rule/doc parity guard
```

There is no linter or formatter configured for this repository itself. Match the file you are
in: two-space indent, single quotes, trailing commas, prose wrapped near 100 columns.

## How a rule is put together

Take `packages/eslint-plugin-security` as the model; all ten ESLint plugins have the same shape.

| Piece | Where | Notes |
| --- | --- | --- |
| The rule | `src/rules/<rule>.ts` | Exports `<camelCaseRule>Rule`, built with `createRule` from `../createRule` |
| The creator | `src/createRule.ts` | `makeCreateRule('<short>')` from `@noctcore/eslint-utils`; it bakes the rule's `meta.docs.url` as `https://noctcore.github.io/eslint-plugins/rules/<short>/<rule>/` |
| Registration | `src/rules/index.ts` | The `rules` map, keyed by the unprefixed rule id |
| The preset | `src/configs/recommended.ts` | `'noctcore-<short>/<rule>': 'error'`, or leave it out on purpose (see the severity policy) |
| Tests | `tests/rules/<rule>.test.ts` | `ruleTester.run(...)` with `ruleTester` from `@noctcore/eslint-test-utils`, run by Vitest |
| The doc | `docs/rules/<rule>.md` | Executed by the test suite. Read the next section before writing it |
| The README table | `README.md` in the package | Generated from the rule's `meta`: run `bun run docs:readmes` (see below) |

`<short>` is the part of the package name after `eslint-plugin-`: `security`, `react`, and so on.
The plugin registers itself under the namespace `noctcore-<short>`, so a consumer writes
`noctcore-security/no-shell-interpolation`.

A rule's `meta` is what the docs site, the README table and the rule-doc header read:
`docs.description` becomes the table row, `fixable` and `hasSuggestions` become the icons. Set
`docs.requiresOptions: true` on a rule that does nothing useful until the consumer passes options
(it reports nothing, or everything, without a per-project fact such as a scope, a model registry or
an action-client list); the table and header mark it ⚙️. `meta.deprecated` renders as ❌ (see
[Deprecating a rule](#deprecating-a-rule)). Whether a rule needs type information is not
declared anywhere; the site detects it from the source (`getParserServices(context)` means
required). Only one rule in the family needs types today, so think hard before adding a second.

### Generated README tables and doc headers

`bun run docs:readmes` (`site/scripts/readmes.ts`) writes two things from the rules' source `meta`
and each package's `recommended` preset:

- the rules table in every package `README.md`, between `<!-- begin generated rules -->` and
  `<!-- end generated rules -->`, with one legend and one column set for every plugin
  (✅ in `recommended` at `error` · ⚙️ needs options · 🔧 `--fix` · 💡 suggestions · 💭 needs type
  info · ❌ deprecated). `lint-meta-rules` gets a table of rule id, factory, entry point and
  category instead;
- a one-line status header in every `docs/rules/<rule>.md`, right after the title and blockquote
  summary, between `<!-- begin generated rule header -->` and `<!-- end generated rule header -->`.
  The site page drops it and shows its own metadata line.

Never edit between the markers by hand. Run the command after adding a rule, changing a
description, or moving a rule in or out of the preset, and commit what it writes. Running it twice
changes nothing. `site/scripts/readmes.test.ts`, part of `bun run test`, regenerates both in memory
and fails with "Run `bun run docs:readmes`" when a file on disk differs. A new package README needs
the marker pair once, where its table goes.

Do not edit the `VERSION` constant in `src/index.ts`. It is rewritten from `package.json` by
`bun run sync:versions` during a release, and `packages/eslint-test-utils/tests/plugin-meta.test.ts`
fails if the two disagree.

### The doc is executable

`docs/rules/<rule>.md` opens with a level-one heading of the full rule id in backticks and a
one-line blockquote summary; the site turns those into the page title and description. The
generated status header follows them (see above). What makes
these docs unusual is that the code examples run. `packages/eslint-test-utils/tests/docs/plugins.test.ts`
imports every plugin from source, reads every doc, lints every labelled example with only that rule
enabled, and fails when an example disagrees with its label. It runs as part of `bun run test`,
in both ESLint legs, so a doc that drifts from its rule fails CI.

The rules of the fences, from `packages/eslint-test-utils/src/docExamples.ts`:

- Every `ts` or `tsx` fence needs a label after the language: `bad`, `good` or `prose`. An
  unlabelled `ts` fence is itself a failure, so nothing sits in a doc unexamined. An unlabelled
  `js` or `jsx` fence (a config snippet) is left alone, but label one and it runs like the rest.
  Other languages (`jsonc`, `text`, `sh`) are never run.
- A `bad` example must draw at least one report from the rule. Add `reports=N` to pin the count
  when the block shows several violations. A parse error is a failure, not a report.
- A `good` example must draw no message at all. A parse error counts as a message.
- A `prose` example is not run and must say why: `reason="the rule reads sibling files from disk"`.
- Examples lint as `src/example.<lang>` unless the fence says `filename=src/api/client.test.ts`.
  Options go on the fence as JSON: `options={"actionClients":["authActionClient"]}`.
- A `good` example must be the fix for a `bad` one, not a way around the rule. It runs under the
  filename and options of some `bad` block in the same doc. If moving the file is the documented
  fix, mark the good block `relocation`; if different options are, mark it `reconfigured`.
- A doc needs at least one `bad` and one `good` example, or a `prose` one with a reason.

So a fence line looks like ` ```ts bad options={"checkLoops":true} ` or ` ```tsx good relocation `.
The pending-fix shape and the doc-to-page pipeline are described at the top of
`site/scripts/sync.ts`, which is also where `options={...}` is rewritten into something the site's
code renderer accepts.

### Rule and doc parity is pinned by hand

`site/scripts/parity.test.ts` (run by `bun run test` through the site workspace, and by
`bun test scripts` inside `site/`) checks three things across the whole repo: every exported rule
has a doc, every doc belongs to an exported rule, and the inventory sees **exactly
`EXPECTED_RULE_COUNT`** rules and docs. That constant is `98` as of this writing and it is
deliberate: the set comparison alone passes if the inventory goes blind, so the number must be
changed by hand, in the same commit that adds or removes a rule and its doc. If your branch is
green everywhere except a test named "the inventory sees exactly 98 rules and 98 docs", this is
why. Bump it.

The same file also lists by name the nine `lint-meta-rules` rules that live behind sub-entry
points (`/i18n`, `/prisma`, `/resolved-config`, `/session`, `/trpc`). Adding one of those means
adding it to that list too, and a new sub-entry point also goes in `LINT_META_SUBPATHS` in
`site/scripts/inventory.ts`.

### Severity policy: `error` or `off`, never `warn`

Every rule in every preset is `error` or `off`. A warning is a rule nobody obeys. This is enforced,
not just stated: each plugin's `tests/configs/recommended.test.ts` fails on any preset entry that is
not `error` or `off`, and a second test in the same file makes leaving a rule out a decision you
write down. In `code-quality`, `prisma` and `security`, which already ship opt-in rules, that test
requires every rule to be in the preset or listed by name in `OMITTED_FROM_PRESETS`. In the other
seven it requires every rule to be in the preset, full stop, so the first opt-in rule in one of those
packages also adds that list to its test, copied from `eslint-plugin-security`. Either way, add a
comment in `src/configs/recommended.ts` saying why the rule is left out.

That gives a new rule two ways to ship, and you should know which before writing it:

- **In `recommended` at `error`.** For a rule that is precise on any codebase without knowing
  anything about the project.
- **Left out of the preset, opt-in.** For a rule that needs a per-project fact (an action-client
  name, a workspace scope, a list of tenant models) or that trades precision for coverage. It
  stays exported and documented; the consumer enables it with their options. With an empty
  option list the rule should either match nothing or report everything, never guess.

There is no third option. If your rule only feels safe at `warn`, it is not precise enough yet.
The [severity policy](https://noctcore.github.io/eslint-plugins/getting-started/#severity-policy)
and the [adoption guide](https://noctcore.github.io/eslint-plugins/adopting/) on the site say the
same thing to consumers.

### Deprecating a rule

A rule is deprecated, not deleted, when it is renamed, merged into another rule or no longer worth
keeping. Consumers who enabled it by name keep a working config until the next major, and ESLint
lists it under "deprecated rules" in their output. To deprecate one:

1. **Set `meta.deprecated` to ESLint's `DeprecatedInfo` object**, and mirror the replacements in
   the older `meta.replacedBy` list:

   ```ts
   meta: {
     deprecated: {
       message: 'Merged into `no-shell-interpolation`, which also covers `execFile`.',
       deprecatedSince: '0.9.0', // the version this change is released in
       availableUntil: '1.0.0', // the next major; null to keep it frozen indefinitely
       replacedBy: [{ rule: { name: 'no-shell-interpolation' } }],
     },
     // ESLint 9.0 to 9.20 only report replacements from this list.
     replacedBy: ['no-shell-interpolation'],
     // ...type, docs, messages and schema unchanged
   },
   ```

   The object form is what ESLint 9.21+ and 10 read, and `@typescript-eslint/utils` types it, so
   `createRule` accepts it on both ESLint versions the tests run against. A replacement with no
   `plugin` is a rule in the same plugin; for a rule in another noctcore plugin add
   `plugin: { name: '@noctcore/eslint-plugin-<short>' }`. `replacedBy: []` says there is no
   replacement. The site reads both forms, but always write the object: the plain
   `deprecated: true` form carries no version or message, so the docs can only say "Deprecated".
2. **Keep the rule exported, tested and documented.** Do not change what it reports.
3. **Take it out of `recommended`**, and add it to `OMITTED_FROM_PRESETS` in that package's
   `tests/configs/recommended.test.ts` (create the list if the package has none). A deprecated
   rule is in no preset, not even at `off`.
4. **Run `bun run docs:readmes`.** The README row gets ❌ and "Replaced by ...", and the rule doc's
   generated header gets `❌ Deprecated since <version>: <message>. Use <replacement> instead.`
   The site page shows the same sentence in a caution banner, the sidebar and the rule tables mark
   it, and `rules.json` and `llms.txt` carry `deprecated` and `replacedBy`.
5. **Add a `minor` changeset** that names the replacement and says what a consumer has to change:
   nothing breaks, but a config that enables the old rule should move to the new one before
   `availableUntil`.

`site/scripts/deprecation.test.ts` fails if a deprecated rule is in a `recommended` preset, if a
`replacedBy` id is not a rule in this repo (or is itself deprecated), or if the rule's doc lacks
the generated deprecation header.

**Removing it** is a breaking change: a config that names a missing rule stops ESLint with an
error. Remove a deprecated rule only in the release its `availableUntil` names, and never before
it has shipped deprecated in at least one minor. Removing it also means deleting its doc,
lowering `EXPECTED_RULE_COUNT` and a changeset that says so loudly.

### What makes a rule acceptable here

The plugins earn their place by catching what generic linters and TypeScript cannot see, at a
precision that lets them run at `error`. A rule that fires on legitimate code at `error` teaches
people to disable the plugin, which costs more than the rule ever caught. So a proposal is judged on:

- **A defect class, not a preference.** Name what breaks in production, or what a reviewer
  reliably misses, when the pattern is present. "It is cleaner" is not a defect.
- **Why nothing else catches it.** If `typescript-eslint`, `eslint-plugin-react`, `unicorn`,
  `import` or the compiler already has it, we do not need a copy.
- **What it must not flag.** This is the question that separates a rule from a wish. Write the
  legitimate code that looks like the bad code, and show the rule stays silent on it. If the only
  way to stay silent is an allowlist, the rule is opt-in.
- **Mostly syntactic.** Prefer shapes the AST proves over heuristics on names. One rule in the
  family uses type information; it is the exception and it fails loudly without a program.
- **Framework-agnostic and de-projected where it can be.** No hardcoded repo layouts, scopes or
  file names; those are options with sensible defaults, as in `monorepo/no-deep-package-imports`
  and `security/server-action-through-client`.
- **Measured where possible.** Before `no-unguarded-web-storage` shipped it was counted on real
  code: 39 unguarded calls in 19 files, every inspected hit a true positive. Numbers like that are
  the strongest argument a proposal can carry.

Open a rule proposal issue before writing a rule you are not sure about. The form asks these
questions, and answering them first saves the round trip.

### `lint-meta-rules` is different

`packages/lint-meta-rules` holds whole-repo checks for `@noctcore/harness`, not ESLint rules. A
rule there is a factory, `create<Name>Rule(options): IMetaRule`, in `src/rules/<id>.ts`, exported
from `src/rules/index.ts` and added to `RULE_FACTORIES`. Tests use `bun test` (not Vitest) with the
fake context helpers in `tests/test-utils/`, and `tests/index.test.ts` lists every rule id and
factory name by hand, so it changes with each addition. Rules that need ESLint at runtime go on a
sub-entry point (`src/resolved-config.ts`, `src/prisma.ts`, `src/i18n.ts`) so the main entry never
loads it. Rules that are inert without a project's own facts (the method that mints a session, the
middleware a router guards with) go on a sub-entry point grouped by the seam they fence
(`src/session.ts`, `src/trpc.ts`) and stay out of `RULE_FACTORIES`, so `createAllRules()` never
registers a rule that checks nothing. These docs are counted by the parity guard but their examples are not executed.

## Changesets

Every change to a published package needs a changeset in `.changeset/`. `bun run changeset` walks
you through it, or write the file by hand:

```md
---
'@noctcore/eslint-plugin-security': minor
---

New rule `server-action-through-client`, shipped off and left out of `recommended`.

(what it flags, what it leaves alone, and whether a consumer's build changes)
```

The body becomes the package's `CHANGELOG.md` entry verbatim, through `@changesets/changelog-github`,
so write it for a consumer reading the changelog, and always say whether a project that spreads
`recommended` as-is will see new errors.

What the history says each bump means here (`git log -- .changeset`):

- **minor**: a new rule, whether it lands in `recommended` at `error` (`no-unguarded-web-storage`,
  react 0.4.0, which can fail a consumer's build) or ships opt-in (`server-action-through-client`,
  security). A preset severity change is also a minor: react 0.3.0 moved two rules from `warn` to
  `error` and said so in its body. A new option with an inert default has gone out as a minor too.
- **patch**: a false positive or false negative fixed, a crash fixed, a doc corrected, a changed
  `meta.version`. Nothing a consumer has to react to.
- **major**: never used yet. Every package is `0.x`, and a breaking change has so far been a
  minor with a loud changelog entry. Ask before you are the first.

Releases are two-phase and automatic (`.github/workflows/release.yml`): merged changesets open a
"Version Packages" PR, and merging that publishes to npm with provenance. You never bump a version
yourself.

## Pull requests

Branch from `main`. Commits follow conventional commits with the package's short name as the scope:
`feat(security): add server-action-through-client`, `fix(react): ...`, `docs(site): ...`,
`ci: ...`. The PR template asks for three things: the changeset, the tests, and whether you ran the
doc examples. CI runs `build`, `typecheck` and `test`, and the docs workflow builds the site on
every PR that touches `packages/` or `site/`, so a rule without a doc fails before merge.

## Reporting

Use the issue forms; they ask for the fields a report needs to be actionable:

- **False positive**: the rule reported code that is correct. Rule id, the code, the message, why
  the code is correct, versions.
- **False negative**: the rule stayed silent on code it documents as bad.
- **Rule proposal**: the defect class, why a generic linter cannot see it, and what it must not flag.
- **Crash or install problem**: a rule that throws, a plugin that fails to load, packaging.

For anything about the docs site, the `site` label. For `lint-meta-rules` or the harness side,
`pkg: lint-meta-rules`.
