# @noctcore/eslint-plugin-security

## 0.2.3

### Patch Changes

- [`ca5f24b`](https://github.com/noctcore/eslint-plugins/commit/ca5f24b5ea45f532c60f92fdca6a77d7cf867773) Thanks [@Shironex](https://github.com/Shironex)! - `prefer-lazy-state-init` now matches storage calls written with a global prefix.

  `window.localStorage.getItem` and `localStorage.getItem` are one call written two ways, and the
  rule compared the dotted path literally, so the default `localStorage.getItem` entry saw only the
  bare form and every `window.`-prefixed call site went unreported. `window.`, `globalThis.` and
  `self.` are now stripped before matching, and an explicitly configured prefixed path still matches
  as written.

  Also corrects the security plugin's README, which wired an example rule at `warn` against the
  house policy that every rule is `error` or `off`.

## 0.2.2

### Patch Changes

- [`734f0f6`](https://github.com/noctcore/eslint-plugins/commit/734f0f610b8b17dd112f514965b3b2d6bbbdf452) Thanks [@Shironex](https://github.com/Shironex)! - Report the real package version in `meta.version`.

  Every plugin published a `meta.version` taken from a literal in its source while the
  version itself came from changesets, so the two drifted: all nine were behind, contracts
  by three minors (it said `0.3.0` while publishing `0.6.0`) and prisma by two (`0.1.0`
  against `0.3.1`). ESLint reads that field to identify a plugin, so anything keyed on
  plugin identity saw a build that had not existed for months.

  The constant is now written from package.json during `version-packages`, and a test
  compares the two so they cannot drift apart again.

- Updated dependencies [[`3166c84`](https://github.com/noctcore/eslint-plugins/commit/3166c8468dcfa29e6c964aa3d0035461b2420e6a)]:
  - @noctcore/eslint-utils@0.1.1

## 0.2.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.0

### Minor Changes

- [`3ee1c6d`](https://github.com/noctcore/eslint-plugins/commit/3ee1c6d24aa0c72e585ef13afe23e9654eeb904b) Thanks [@Shironex](https://github.com/Shironex)! - Add `no-user-controlled-fetch-url` (SSRF) and `no-user-controlled-redirect` (open redirect), ported from tsforge (MIT) and both in `recommended`. They check that a URL's origin is fixed at authoring time, catch the `https://host${p}` userinfo trick, resolve in-file `const` bindings, and take `trustedOrigins`, `sanitizers` and `trustedPaths` options. The redirect rule's `redirectCallees` names the URL argument index, so Express `res.redirect(302, url)` is covered.
