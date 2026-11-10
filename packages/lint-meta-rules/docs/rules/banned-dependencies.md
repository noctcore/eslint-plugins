# `banned-dependencies`

> No workspace manifest declares a package the repo has decided against.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createBannedDependenciesRule` from `@noctcore/lint-meta-rules` · Category `supply-chain` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

Some dependencies come back without anyone writing `add`: a CLI offers to reinstall a package it
needs and leaves a dirty manifest nobody authored, a new workspace copies an old `package.json`, or a
package the team dropped for its advisories returns through a copy-pasted snippet. A review catches a
hand-written dependency, not these. Naming the package once, with the reason, turns the decision into
a check.

## What it flags

Every banned name in `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`
of the root `package.json` and of every `apps/*`, `packages/*` and `tools/*` manifest. The message
quotes your reason.

```ts
createBannedDependenciesRule({
  banned: { axios: 'Use the platform `fetch`; the team dropped axios over its advisories.' },
});
```

```json
// apps/web/package.json: reported
{ "dependencies": { "axios": "^1.7.0" } }
```

## What it does not flag

- Anything at all until `banned` names a package: the default is `{}`.
- A transitive dependency: only what a manifest declares is read, not the lockfile.
- A manifest outside `manifestGlobs`, and one that is not valid JSON (another rule should own that).

## Options

```ts
createBannedDependenciesRule(options?: BannedDependenciesOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `banned` | `Record<string, string>` | `{}` | Package name to the reason it is banned, quoted in the message. |
| `manifestGlobs` | `string[]` | `['package.json', 'apps/*/package.json', 'packages/*/package.json', 'tools/*/package.json']` | Manifests to read. `node_modules`, `dist` and similar are always skipped. |
| `dependencyFields` | `string[]` | `['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']` | Manifest fields to read. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If no package is off limits in your repo, there is nothing to configure. For a ban on what gets
imported in source rather than installed, use ESLint's `no-restricted-imports`.
