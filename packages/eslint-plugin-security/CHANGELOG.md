# @noctcore/eslint-plugin-security

## 0.2.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.0

### Minor Changes

- [`3ee1c6d`](https://github.com/noctcore/eslint-plugins/commit/3ee1c6d24aa0c72e585ef13afe23e9654eeb904b) Thanks [@Shironex](https://github.com/Shironex)! - Add `no-user-controlled-fetch-url` (SSRF) and `no-user-controlled-redirect` (open redirect), ported from tsforge (MIT) and both in `recommended`. They check that a URL's origin is fixed at authoring time, catch the `https://host${p}` userinfo trick, resolve in-file `const` bindings, and take `trustedOrigins`, `sanitizers` and `trustedPaths` options. The redirect rule's `redirectCallees` names the URL argument index, so Express `res.redirect(302, url)` is covered.
