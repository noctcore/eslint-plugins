# @noctcore/eslint-plugin-security

## 0.4.1

### Patch Changes

- [#44](https://github.com/noctcore/eslint-plugins/pull/44) [`da6ce97`](https://github.com/noctcore/eslint-plugins/commit/da6ce97dbfa4eb3a3bb39444929276661d8857b7) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README now follows the same layout in every
  package: requirements, install, a quick start with `files` and the TypeScript parser, one config
  block for every opt-in rule, the rules table and the severity policy. Every rule doc now has the same
  sections in the same order: why, what it flags, what it does not flag, options, when not to use it.

- [#40](https://github.com/noctcore/eslint-plugins/pull/40) [`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. Each package's npm page now links to its page on the
  docs site (`homepage` and a **Docs** link at the top of the README), and every plugin README states
  its requirements: ESLint 9 or newer, flat config only, and a `recommended` preset that sets no `files`
  and no parser, with a snippet for linting TypeScript. `@noctcore/eslint-utils` ships a README. Rule
  docs describe what a rule does today; third-party credits moved to a short section at the end.

- [#41](https://github.com/noctcore/eslint-plugins/pull/41) [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The rules table in each README is now generated from
  the rules' own metadata, with the same columns in every package: in `recommended`, needs options,
  fixable, suggestions, needs type information. Rule links point at the docs site. Every rule doc
  now opens with a one-line status header saying the same. Rules that do nothing until configured
  carry a new `meta.docs.requiresOptions: true`, and `@noctcore/eslint-utils` types that field
  (`NoctcoreRuleDocs`). A project that spreads `recommended` sees no new errors.
- Updated dependencies [[`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885), [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70)]:
  - @noctcore/eslint-utils@0.1.2

## 0.4.0

### Minor Changes

- [#18](https://github.com/noctcore/eslint-plugins/pull/18) [`7159ef5`](https://github.com/noctcore/eslint-plugins/commit/7159ef54226d96c692a662a0dd811bcb020c790a) Thanks [@Shironex](https://github.com/Shironex)! - Two new rules: `no-timing-unsafe-compare`, in `recommended` at `error`, and `require-sanitized-html`,
  shipped off and left out of `recommended`.

  `no-timing-unsafe-compare` reports `===`, `!==`, `==`, `!=` and `Buffer#equals` when exactly one
  side is a secret and the other is a runtime value. A secret is decided by provenance, not by name:
  `.digest()` on a `createHmac(...)` chain (through `.update()` calls and `const` bindings), the
  result of `crypto.subtle.sign(...)`, or an expression listed in the new `secretSources` option,
  also when re-encoded through `Buffer.from`, `new Uint8Array` or `.toString()`. It leaves alone
  unkeyed `createHash` digests (ETags, cache keys), comparisons against a literal, `undefined` or
  `null`, two secrets compared with each other (the double-HMAC defence) and length guards. It does
  not check `timingSafeEqual` for a missing length guard, since equal lengths often hold by
  construction and the syntax cannot tell.

  `require-sanitized-html` reports HTML reaching JSX `dangerouslySetInnerHTML`, `innerHTML`,
  `outerHTML` or `insertAdjacentHTML` unless the rule can see it is static markup, a same-file
  `const` bound to static markup, or the result of a sanitizer (`sanitizers`, default
  `DOMPurify.sanitize`, `sanitize`, `sanitizeHtml`, `xss`, `filterXSS`). It is opt-in because real
  code has trusted HTML no syntactic rule can prove safe, such as a syntax highlighter's output;
  name those producers in `trustedSources`.

  A project that spreads `recommended` will see new errors wherever an HMAC digest or Web Crypto
  signature is compared with `===` or `Buffer#equals` instead of `crypto.timingSafeEqual`.
  `require-sanitized-html` changes nothing until you enable it.

## 0.3.0

### Minor Changes

- [`9c77a6b`](https://github.com/noctcore/eslint-plugins/commit/9c77a6b1695f002deddd6767e19fa2086c48babc) Thanks [@Shironex](https://github.com/Shironex)! - New rule `server-action-through-client`, shipped off and left out of `recommended`.

  In a module whose first statement is `'use server'`, every exported action must be built
  from an action client named in `actionClients` (`actionClient.inputSchema(...).action(...)`,
  `createServerFn().middleware([...]).handler(...)`), and no raw `export async function` may
  appear. A raw exported function is a public POST endpoint with no input schema, no error
  policy and no middleware, so no auth middleware either. The rule does not decide which client
  is right: a public form built from an unauthenticated client is correct code, and the client's
  name at the definition site is where a reviewer reads that choice.

  Inline actions (`async function x() { 'use server'; ... }` in a component body) cannot go
  through a client and are reported unless `allowInline` is set. Non-function exports, re-exports
  and modules without the directive are left alone. With an empty `actionClients` the rule accepts
  no client and reports every exported action, so enabling it without configuration is loud, not
  silent.

  No consumer's build changes: the rule is opt-in and needs per-project client names.

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
