# @noctcore/eslint-plugin-security

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#158](https://github.com/noctcore/eslint-plugins/pull/158) [`0a6b8a2`](https://github.com/noctcore/eslint-plugins/commit/0a6b8a2998af035bcbfe18fd41eb312456cca05a) Thanks [@Shironex](https://github.com/Shironex)! - New rule `presigned-post-requires-policy`, and wider coverage in `no-shell-interpolation` and `require-path-containment`.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - New rule `presigned-post-requires-policy`, in `recommended` at `error`: a `createPresignedPost` call must state `['content-length-range', min, max]` and `['eq', '$Content-Type', type]` in a literal `Conditions` array. Without them the browser chooses the upload size and the stored Content-Type. It only looks at calls named `createPresignedPost`.
  - `no-shell-interpolation` follows `promisify(exec)` bindings (`const execAsync = promisify(exec); execAsync(\`git checkout ${b}\`)` is reported), and treats any `shell` option that is not statically off (`false`, `null`, `undefined`, `''`) as a shell. `spawn(\`git ${b}\`, { shell: process.platform === 'win32' })` is now reported: it is an injection sink on Windows.
  
  **Opt-in rule changes** (`require-path-containment`, not in `recommended`):
  
  - It sees `join` / `resolve` imported from `path` or `node:path`, renamed or not, and default or namespace imports under any name, not only `path.join`.
  - A guard must test the joined value: `full.startsWith(...)`, `path.relative(base, full)`, or a helper named in the new `containmentGuards` option. A `.startsWith` on some other string (`name.startsWith('.')`) or a bare `path.normalize(full)` no longer silences it.

- [#181](https://github.com/noctcore/eslint-plugins/pull/181) [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5) Thanks [@Shironex](https://github.com/Shironex)! - The three fetch rules now take one shared wrapper list under one option name, `fetchCallees`, so a project declares its fetch wrapper once and passes the same list to all of them:
  
  ```js
  const fetchCallees = ['fetch', 'http.fetchWithCsrfRetry'];
  // async-safety/require-fetch-timeout, contracts/fetch-must-check-ok,
  // security/no-user-controlled-fetch-url: ['error', { fetchCallees }]
  ```
  
  An entry is a string (`'http.fetchWithRetry'`: the last segment is the method, the rest is the receiver as written) or an object (`{ object: 'axios', name: 'get', urlArgument: 0, urlProperty: 'url' }`). The URL position is read only by the security rule.
  
  - async-safety `require-fetch-timeout`: new `fetchCallees`; `callees` is a deprecated alias kept through 1.x (both lists are combined). The global `fetch` is still always checked. A wrapper rooted at `this` (`this.api.get`) can now be listed.
  - contracts `fetch-must-check-ok`: new `fetchCallees`; `fetchFunctions` is a deprecated alias kept through 1.x (both lists are combined; with neither set the default is still `['fetch']`).
  - security `no-user-controlled-fetch-url` and `no-user-controlled-redirect`: `fetchCallees` and `redirectCallees` now also accept the string form.
  
  Nothing breaks and the defaults are unchanged, so a project that spreads `recommended` sees no new reports. `@noctcore/eslint-utils` adds `matchFetchCallee`, `normalizeFetchCallees`, `toFetchCalleeSpec`, `fetchCalleeText`, `fetchCalleesSchema`, `fetchCalleeEntrySchema` and the `FetchCalleeSpec` / `FetchCalleeEntry` types.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

- [#165](https://github.com/noctcore/eslint-plugins/pull/165) [`b957e4b`](https://github.com/noctcore/eslint-plugins/commit/b957e4bcf3e5d0723c620609056161bb77e168c9) Thanks [@Shironex](https://github.com/Shironex)! - Internal: use `calleeName` from `@noctcore/eslint-utils` instead of a private copy, and walk the parser's visitor keys instead of `Object.keys` in `no-sensitive-fields-in-logs` and `no-error-detail-loss`. No report changes. The `no-sensitive-fields-in-logs` options now carry schema descriptions.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` config object now has a `name` (`noctcore-<plugin>/recommended`), so the ESLint config inspector and config error messages show which block it is instead of an anonymous one. Nothing else about the preset changes.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0

## 0.4.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`fc9a372`](https://github.com/noctcore/eslint-plugins/commit/fc9a37226fb85f285b5211545708e833a9d962ae) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The `meta.docs.description` of `require-path-containment`, `server-action-through-client` (security) and `colocated-test-required` (architecture) no longer ends with an "opt-in" note: the rules table and rule page now show that with 🔘. The rules are still left out of `recommended`, so a project that spreads the preset as-is sees no change.

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
