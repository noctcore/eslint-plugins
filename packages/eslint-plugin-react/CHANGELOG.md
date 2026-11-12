# @noctcore/eslint-plugin-react

## 1.1.0

### Minor Changes

- [#190](https://github.com/noctcore/eslint-plugins/pull/190) [`1e9b944`](https://github.com/noctcore/eslint-plugins/commit/1e9b944aed41102928cc1510d90f5af92ef2a3a1) Thanks [@Shironex](https://github.com/Shironex)! - New rule `max-state-per-hook`, on in `strict` at `error` and left out of `recommended`.
  
  In hook files (`*.hooks.ts` and `*.hooks.tsx` by default), it caps the `useState` / `useReducer`
  slots one `use*` hook keeps (`max`, default 4; a private sub-hook has its own budget, and a frozen
  `const [x] = useState(init)` is skipped unless `countFrozen` is set), and the distinct `useState`
  setters one function nested in a hook calls (`maxSettersPerFunction`, default 3, `0` turns it off).
  `useRef`, query and mutation hooks, `dispatch`, and setters from props or context are not counted.
  The file gate is `hookFileSuffixes`, also accepted as `fileSuffixes` (the name `max-hooks-per-file`
  uses); when both are set they are combined.
  
  A project that spreads `recommended` sees no change. A project that spreads `strict` can see new
  errors on hooks that keep more than four pieces of state or set more than three of them in one
  handler; raise the options or turn the rule off to keep the previous behaviour.

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#166](https://github.com/noctcore/eslint-plugins/pull/166) [`9ec4933`](https://github.com/noctcore/eslint-plugins/commit/9ec49336446849d6c4475e75e12e9ee634fd2ffa) Thanks [@Shironex](https://github.com/Shironex)! - Three new rules.
  
  - `password-input-requires-autocomplete` (in `recommended` at `error`): a JSX element whose `type` can be `"password"` (a literal, either branch of a show/hide conditional, or a `const` holding one) must carry an `autoComplete` that names a purpose. A spread such as `{...field}` does not count, and a bare, empty, `{undefined}` or `{null}` value is reported like a missing one. Any explicit value, `"off"` included, satisfies it. **A project that spreads `recommended` can see new errors**: measured on four real React apps, it found one field (a masked API token with no `autoComplete`).
  - `no-native-date-input` (opt-in, left out of `recommended`): reports `<input>` / `<Input>` with a literal `type` of `date`, `datetime-local`, `month` or `week`, which Chromium formats in the browser UI language regardless of `lang`. Options: `elementNames`, `types`, `replacement` (named in the message) and `allowIn`.
  - `enforce-context-consumption` (opt-in, needs options): with a `contexts` registry of `{ hook, files, providedProps }`, reports a `*Props` member or a destructured `*Props` parameter property, in the registered files, whose name the context already supplies. Checks nothing without the registry.

- [#161](https://github.com/noctcore/eslint-plugins/pull/161) [`7167c8b`](https://github.com/noctcore/eslint-plugins/commit/7167c8b049d8a93d3ac7f99793fa00b1529d684b) Thanks [@Shironex](https://github.com/Shironex)! - Close gaps in three `recommended` rules and move the `max-hooks-per-file` report off the whole file.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - `no-unguarded-web-storage` now requires a `try` with a `catch`: a `try` with only a `finally` no longer counts as a guard. A callback defined inside a `try` but run later (a listener, a timer, a `.then` callback, an async IIFE) is no longer treated as guarded; an IIFE and the callback of a synchronous array method (`forEach`, `map`, `Array.from`, ...) still are. The rule also reports plain member reads (`localStorage.length`, `sessionStorage['key']`) and reads through a `const` alias (`const store = window.localStorage; store.getItem(...)`). A bare reference such as `createJSONStorage(() => localStorage)` is still left alone.
  - `require-effect-cancellation` no longer takes every top-level `return` for a cancellation guard. A returned cleanup counts when it sets something (`cancelled = true`, `live.current = false`), calls an abort or cancel method, or cannot be seen into (`return unsubscribe`). A cleanup that only clears a timer or removes a listener no longer silences the rule.
  
  **Report placement:** `max-hooks-per-file` reports on the first exported hook past the limit instead of on the whole file, so an editor underlines the export to move. The count and the message are unchanged.
  
  `component-props-naming`, `no-effect-derived-state` and `require-effect-cancellation` walk the tree over the parser's visitor keys (shared helpers from `@noctcore/eslint-utils`) instead of every object key. No report changes from that.
  
  `no-state-in-component-body` gains no `includeNestedComponents` option: it already checks every `.tsx`, nested sub-components included, and its doc now says so and shows how to skip stories and component tests with `hookFileSuffixes`.

- [#147](https://github.com/noctcore/eslint-plugins/pull/147) [`1763344`](https://github.com/noctcore/eslint-plugins/commit/176334422a43fc888e9c078c5b81fbecaf67779d) Thanks [@Shironex](https://github.com/Shironex)! - Fix false positives and false negatives in seven `recommended` rules, and stop the `component-props-naming` autofix writing code that does not compile.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - `prefer-lazy-state-init` now sees the call under a TypeScript wrapper or a fallback: `useState(JSON.parse(raw) as Foo)`, `useState(JSON.parse(raw) ?? {})`, `useState(localStorage.getItem('k')!)`. The fix wraps the whole argument.
  - `context-value-must-be-memoized` now reports an inline array (`value={[a, b]}`) and an inline arrow or function, and scans every file with JSX instead of `.tsx` only. A call (`value={store.snapshot()}`) is still left alone.
  - `no-state-in-component-body` now reports hooks called through a namespace (`React.useState(0)`).
  
  **Reports less:**
  
  - `no-effect-derived-state` and `require-effect-cancellation` no longer take every `setX(...)` call for a state setter. The callee must resolve, through scope analysis, to a setter destructured from `useState` / `useReducer` (or the `dispatch` of `useReducer`). `setTimeout`, `setInterval`, and a setter from a context hook or a prop are no longer reported. `no-effect-derived-state` also skips prop-to-state with local edits (`const [draft, setDraft] = useState(value)` re-synced from `value`).
  - `component-props-naming` no longer reports a props type that is not declared in the file (`import type { IconProps } from './types'`): a shared or library props type is correct as written. A new `pattern` option (default `{Component}Props`) expresses `I{Component}Props` for codebases with an interface-prefix rule.
  - `props-must-be-visual` anchors the `token` and `secret` defaults at the end of the name (`token$`, `secret$`), so a design `tokens` list, a `tokenCount` and a `showSecretField` flag are no longer reported. `resetToken` and `clientSecret` still are. A project that set `denyPropNames` keeps its list.
  
  **Autofix change:** `component-props-naming` refuses the rename when the type is exported through a later `export { Props }` / `export type { Props }`, when any mention of the name is not a plain type reference (`interface Wide extends Props`, `implements Props`), or when the type is declared more than once. Before, the fix renamed the declaration and the parameter and left `extends Props` and the re-export pointing at nothing.

- [#179](https://github.com/noctcore/eslint-plugins/pull/179) [`76b921c`](https://github.com/noctcore/eslint-plugins/commit/76b921c3796e7bf970447a4c2fcc6453a1418b38) Thanks [@Shironex](https://github.com/Shironex)! - **Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-react/strict`): `recommended` plus the house rules. The props naming scheme, the size caps and the thin component shell leave `recommended` and are on in `strict`.
  
  Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.
  
  - `no-jsx-computation`: 46 / 29 / 134 / 235
  - `no-state-in-component-body`: 106 / 137 / 158 / 35
  - `component-props-naming`: 44 / 38 / 45 / 0
  - `max-hook-return-surface`: 10 / 32 / 9 / 7
  - `max-props-per-component`: 5 / 2 / 3 / 3
  - `max-hooks-per-file`: 0 / 0 / 0 / 0 (size cap)
  
  To keep linting as before, spread `react.configs.strict` where you spread `react.configs.recommended`, or enable the rules one by one.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` config object now has a `name` (`noctcore-<plugin>/recommended`), so the ESLint config inspector and config error messages show which block it is instead of an anonymous one. Nothing else about the preset changes.

- [#175](https://github.com/noctcore/eslint-plugins/pull/175) [`5b9525b`](https://github.com/noctcore/eslint-plugins/commit/5b9525b8154999d58806b2bb7394b592a62607ee) Thanks [@Shironex](https://github.com/Shironex)! - `max-hooks-per-file` no longer counts pass-through re-exports (`export { useA } from './useA'`). The hook is counted in the module that defines it, so a file that passes hooks on no longer goes over the limit for them. The doc also shows how to cover a `hooks/` directory of plain modules with `fileSuffixes: ['.ts', '.tsx']` in a scoped block.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0

## 0.4.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

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

- [`42ecbd9`](https://github.com/noctcore/eslint-plugins/commit/42ecbd9f98a51d9377530770a44873b4cb0ba80e) Thanks [@Shironex](https://github.com/Shironex)! - New rule `no-unguarded-web-storage`, shipped as `error` in `recommended`.

  A `localStorage` / `sessionStorage` call must sit inside a `try` block. The property access
  itself throws when storage is disabled (private browsing, blocked cookies, a sandboxed iframe,
  storage partitioning), and `setItem` throws on an exhausted quota. The code compiles and the
  tests pass under jsdom, then the exception lands in a render for a slice of real users.

  The rule flags any storage method call, written bare or through `window.`, `globalThis.` or
  `self.`, with no enclosing `try` at any depth. A `typeof window === 'undefined'` check is not a
  guard: it fences off the server, and the throw happens in the browser. It stays silent for a
  wrapper object, a non-call reference, a locally declared `localStorage`, storage code written as
  text inside a string, and files matched by `allowIn` (tests and specs by default). A suggestion
  wraps a plain expression or return statement in `try { ... } catch { ... }`.

  Projects that spread `react.configs.recommended` will now fail lint on an unguarded storage
  call. Wrap it, move it into a guarded helper, or exempt the path with `allowIn`.

### Patch Changes

- [`ca5f24b`](https://github.com/noctcore/eslint-plugins/commit/ca5f24b5ea45f532c60f92fdca6a77d7cf867773) Thanks [@Shironex](https://github.com/Shironex)! - `prefer-lazy-state-init` now matches storage calls written with a global prefix.

  `window.localStorage.getItem` and `localStorage.getItem` are one call written two ways, and the
  rule compared the dotted path literally, so the default `localStorage.getItem` entry saw only the
  bare form and every `window.`-prefixed call site went unreported. `window.`, `globalThis.` and
  `self.` are now stripped before matching, and an explicitly configured prefixed path still matches
  as written.

  Also corrects the security plugin's README, which wired an example rule at `warn` against the
  house policy that every rule is `error` or `off`.

## 0.3.1

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

## 0.3.0

### Minor Changes

- [`bc5d82f`](https://github.com/noctcore/eslint-plugins/commit/bc5d82ff4871f2b865aaf0441516f73a58324fc6) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-plugin-react`: **behaviour change for consumers.** The `recommended` preset no
  longer ships any rule at `warn`. House policy is `error` or `off`: a warning is a rule nobody obeys,
  and a project that refuses `warn` in its resolved config could not use the preset at all.

  - `no-effect-derived-state`: `warn` to `error`. It fires only on an effect whose whole body is
    `setX(...)` of values read from its own deps; any branch, call, await or cleanup bails out.
  - `require-effect-cancellation`: `warn` to `error`. A state update after an await with nothing to
    cancel it is a real bug, and any recognisable guard (an `AbortController`, a `cancelled` flag, a
    cleanup `return`) silences it.

  Projects that spread `react.configs.recommended` as-is will now fail lint on findings that used to
  print as warnings. To keep the old behaviour, set either rule back yourself after the preset. A test
  in every plugin now fails if any preset emits `warn`.

  `@noctcore/eslint-plugin-contracts`: `money-must-be-decimal` gains a `minorUnitPatterns` option.
  Payment APIs such as Stripe carry money as an integer count of minor units (`amount: 1999` is
  19.99), which is exact in a `number`. List the regex fragments (case-insensitive, unanchored, so
  anchor them: `['^amount$', 'Cents$']`) that name such fields and the rule skips them. The default is
  empty, so nothing changes until you opt in.

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.1

### Patch Changes

- [`3cc17aa`](https://github.com/noctcore/eslint-plugins/commit/3cc17aa9c882ff1be503476536dccd6fc2197b29) Thanks [@Shironex](https://github.com/Shironex)! - `max-hook-return-surface` no longer crashes on a top-level `return` in a hook file. Its enclosing-function walk stopped only on `undefined`, but `Program.parent` is `null` at runtime, so the walk dereferenced `null` once it climbed past `Program`.

## 0.2.0

### Minor Changes

- Add 5 rules: `prefer-lazy-state-init` (fixable), `no-jsx-in-hooks`, `component-props-naming` (fixable), and conservative `warn`-level `require-effect-cancellation` and `no-effect-derived-state`.
