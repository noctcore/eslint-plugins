---
'@noctcore/eslint-plugin-security': minor
---

New rule `presigned-post-requires-policy`, and wider coverage in `no-shell-interpolation` and `require-path-containment`.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- New rule `presigned-post-requires-policy`, in `recommended` at `error`: a `createPresignedPost` call must state `['content-length-range', min, max]` and `['eq', '$Content-Type', type]` in a literal `Conditions` array. Without them the browser chooses the upload size and the stored Content-Type. It only looks at calls named `createPresignedPost`.
- `no-shell-interpolation` follows `promisify(exec)` bindings (`const execAsync = promisify(exec); execAsync(\`git checkout ${b}\`)` is reported), and treats any `shell` option that is not statically off (`false`, `null`, `undefined`, `''`) as a shell. `spawn(\`git ${b}\`, { shell: process.platform === 'win32' })` is now reported: it is an injection sink on Windows.

**Opt-in rule changes** (`require-path-containment`, not in `recommended`):

- It sees `join` / `resolve` imported from `path` or `node:path`, renamed or not, and default or namespace imports under any name, not only `path.join`.
- A guard must test the joined value: `full.startsWith(...)`, `path.relative(base, full)`, or a helper named in the new `containmentGuards` option. A `.startsWith` on some other string (`name.startsWith('.')`) or a bare `path.normalize(full)` no longer silences it.
