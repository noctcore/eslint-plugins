# `noctcore-packages-current`

> Every installed `@noctcore/*` package matches its declared range, and that range reaches the latest published version.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createNoctcorePackagesCurrentRule` from `@noctcore/lint-meta-rules` · Category `supply-chain` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A caret range on a 0.x version does not cross the minor: `^0.2.0` admits `0.2.9` and never `0.3.0`.
So a new minor of a plugin is published, the consumer keeps resolving the old one, and nothing says
so. Lint stays green, because the rules the config wires still exist; the new rules and fixes are
simply not there. The same mistake has hidden whole releases from consumer repos more than once.

## What it flags

For every `^x.y.z` or `~x.y.z` range on a package of the scope (default `@noctcore`) in the root
`package.json` and every `apps/*`, `packages/*` and `tools/*` manifest:

- **Offline, always.** The installed version (read from the manifest's own `node_modules`, then each
  parent up to the root, as Node resolves it) is outside the range: above it (the range cannot reach
  what is installed) or below it (a stale install). A declared package that is not installed at all
  is reported too, since what actually loads cannot be checked.
- **Registry, with `checkRegistry: true`.** The latest published version is past what the range
  admits. This is the half the offline check cannot see: declared and installed agree perfectly
  while both sit a minor behind.

```json
// package.json, with 0.3.1 published: reported by the registry half
{ "devDependencies": { "@noctcore/eslint-plugin-react": "^0.2.0" } }
```

The fix is to widen the range (`^0.3.1`) and reinstall.

## What it does not flag

- An exact pin (`0.4.0`), a `workspace:` link, a tag or a URL: each says what it means.
- Packages outside the scope.
- **An unreachable registry.** Offline, a DNS failure or a timeout skips the registry half; it
  never fails the run.
- **A stale registry read right after a publish.** The registry can keep answering the previous
  "latest" for a while. When the installed version is at or past what the registry calls latest,
  the registry is behind, not the repo, and nothing is reported.

## Options

```ts
createNoctcorePackagesCurrentRule(options?: NoctcorePackagesCurrentOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | `string` | `'@noctcore'` | npm scope whose packages are checked. |
| `manifestGlobs` | `string[]` | `['package.json', 'apps/*/package.json', 'packages/*/package.json', 'tools/*/package.json']` | Manifests to read. |
| `checkRegistry` | `boolean` | `false` | Also compare each range with the registry's latest version. |
| `registryUrl` | `string` | `'https://registry.npmjs.org'` | Registry base URL for the registry half. |
| `registryTimeoutMs` | `number` | `5000` | Per-request timeout for the registry half. |
| `fetchLatest` | `(name: string) => Promise<string \| null>` | npm registry read | Replaces the registry read: a private registry, a cache file, or a test stub. Return `null` when unknown. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

The registry half is off by default so `lint-meta` never needs the network. Turn it on in the gate
you finish a release against, or in a scheduled job:

```ts
createNoctcorePackagesCurrentRule({ checkRegistry: true });
```

## When not to use it

If you pin `@noctcore/*` exactly and bump by hand, or use none of its packages, skip it.
