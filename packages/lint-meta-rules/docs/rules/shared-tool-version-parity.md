# `shared-tool-version-parity`

> Workspace packages that declare the same dev tool (eslint, typescript, prettier, or a configured prefix) must declare the same version; `workspace:` and `catalog:` specifiers are skipped.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createSharedToolVersionParityRule` from `@noctcore/lint-meta-rules` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

Two workspace packages that declare the same dev tool at different versions lint, format or
type-check with different rule sets. A change passes in one package and fails in the next, a fix
that works under one TypeScript breaks under the other, and the root lock file carries two copies of
a tool everyone believes is shared. Comparing the declarations across the workspace catches the drift
when it is introduced, not when the two packages first disagree about a file.

### Opt-in

The rule is in `RULE_FACTORIES` and in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` skips it and
adding it gives no existing caller a new violation. Code that iterates `RULE_FACTORIES` or `RULE_IDS`
itself does build it, at `ciCritical: true`: filter out `OPT_IN_RULE_IDS` there if you do not want it.
Enable it by naming it in `optIn`, or by calling its factory:

```ts prose
import { createAllRules, createSharedToolVersionParityRule } from '@noctcore/lint-meta-rules';

const everything = createAllRules({ optIn: ['shared-tool-version-parity'] });
const justThisOne = createSharedToolVersionParityRule({ toolPrefixes: ['@acme/'] });
```

## What it flags

Every declaration of a tool that two or more packages declare at more than one version. A tool is a
name in `tools`, or any dependency whose name starts with one of `toolPrefixes`. Each declaration is
reported in its own `package.json`, at the line of the dependency, and the message lists every version
with the packages that declare it.

```jsonc
// Bad
// apps/web/package.json
{ "devDependencies": { "typescript": "5.6.3" } }
// apps/api/package.json
{ "devDependencies": { "typescript": "5.7.2" } }

// Good
// apps/web/package.json
{ "devDependencies": { "typescript": "5.7.2" } }
// apps/api/package.json
{ "devDependencies": { "typescript": "5.7.2" } }
```

Versions are compared as written, so `^5.7.2` against `5.7.2` is drift: that matches an exact-pin
policy, and a range policy is not supported yet. The packages are the root `package.json` (unless
`includeRoot` is `false`) and the directories `workspaces` names: by default the root `workspaces`
field (an array or `{ packages }`), else the `packages:` list of `pnpm-workspace.yaml`. A `!` entry
excludes the directories it matches.

## What it does not flag

- A tool only one package declares, so a package that does not use a tool is never asked to add it.
- `workspace:` and `catalog:` specifiers. With pnpm catalogs the version lives in one place and this
  drift cannot happen.
- Two declarations of a tool in one package (`dependencies` and `devDependencies`), and a package
  outside the workspaces.
- A `package.json` that is not valid JSON: other rules report that.

## Options

```ts
createSharedToolVersionParityRule(options?: SharedToolVersionParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tools` | `string[]` | `['eslint', 'typescript', 'prettier', 'typescript-eslint', '@eslint/js']` | Dependency names compared across packages. |
| `toolPrefixes` | `string[]` | `[]` | Every dependency whose name starts with one of these is compared too, for example `['@acme/']`. |
| `workspaces` | `string[]` | the root `workspaces`, else `pnpm-workspace.yaml` `packages:` | Workspace directories as globs; a leading `!` excludes. |
| `includeRoot` | `boolean` | `true` | Compare the root `package.json` as one more declarer. |
| `fields` | `string[]` | `['dependencies', 'devDependencies']` | The `package.json` fields read. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

A monorepo that pins tools per package on purpose (a legacy app held on an older TypeScript while the
rest moves) should exclude that package with a `!` entry in `workspaces`, or leave the rule off. A
repository that already resolves every shared tool through a pnpm catalog gains nothing from it.

## Related

- [`node-version-parity`](./node-version-parity.md) keeps the Node version in step across the version
  file, `engines`, CI and images.
- [`security-scanner-version-parity`](./security-scanner-version-parity.md) does the same for the
  secret scanner's version in CI and the pre-push hook.
