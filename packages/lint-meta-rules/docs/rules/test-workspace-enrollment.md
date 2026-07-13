# `test-workspace-enrollment`

> Every tested package must be enumerated in the aggregate test script.

## Why

When the CI test command is a hardcoded list of workspace paths, a package added without editing that
list runs in **no gate** — its tests exist but never execute. This rule fails when any candidate
package that actually has test files is missing from the aggregate script, so a new tested workspace
cannot silently escape CI.

## What it flags

Reads the root manifest's `scriptName` command. For each candidate directory (from `packageGlobs`
plus `extraDirs`, minus `excludeDirs`) that contains at least one file matching `testGlobSuffix`, if
the directory string does not appear in the script command, it is flagged. A missing or invalid
manifest is a no-op.

## Factory

```ts
createTestWorkspaceEnrollmentRule(options?: TestWorkspaceEnrollmentOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scriptName` | `string` | `'test:node'` | Root-manifest script that must enumerate every tested package. |
| `manifestPath` | `string` | `'package.json'` | The root manifest path. |
| `packageGlobs` | `string[]` | `['packages/*/package.json']` | Candidate test workspaces. |
| `extraDirs` | `string[]` | `[]` | Extra directories to check beyond the globbed packages. |
| `excludeDirs` | `string[]` | `[]` | Directories tested by a different runner/script. |
| `testGlobSuffix` | `string` | `'**/*.test.ts'` | Glob suffix (per dir) that detects the presence of tests. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded the `test:node` script, a `packages/*` + `apps/sidecar`
dir list, and a vitest exclusion set.

## When not to use it

If your test runner discovers packages automatically (no hardcoded path list), this rule is
unnecessary.
