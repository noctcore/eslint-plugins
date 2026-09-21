# @noctcore/eslint-plugin-security

## 0.2.0

### Minor Changes

- [`3ee1c6d`](https://github.com/noctcore/eslint-plugins/commit/3ee1c6d24aa0c72e585ef13afe23e9654eeb904b) Thanks [@Shironex](https://github.com/Shironex)! - Add `no-user-controlled-fetch-url` (SSRF) and `no-user-controlled-redirect` (open redirect), ported from tsforge (MIT) and both in `recommended`. They check that a URL's origin is fixed at authoring time, catch the `https://host${p}` userinfo trick, resolve in-file `const` bindings, and take `trustedOrigins`, `sanitizers` and `trustedPaths` options. The redirect rule's `redirectCallees` names the URL argument index, so Express `res.redirect(302, url)` is covered.
