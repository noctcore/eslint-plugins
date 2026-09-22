# Security

This file says what a vulnerability in a lint plugin can be, what is not one, and where to send
a report.

## What counts

These packages run at development time and in CI with the developer's privileges, on the
developer's own source. That narrows the surface, but it does not empty it:

- **Code execution or file access beyond the lint target.** Some rules read files from disk by
  design: `noctcore-monorepo/no-unexported-subpath-import` reads a workspace package's
  `package.json`, `noctcore-contracts/env-var-schema-parity` reads the configured env schema file,
  `noctcore-architecture/colocated-test-required` lists a directory,
  `noctcore-code-quality/fake-timers-must-be-restored` reads sibling files, the prisma tenant rules
  read `prisma/schema.prisma`, and every `lint-meta-rules` check walks the repo. A path taken
  from lint input that escapes the repo, or anything that evaluates repository content, is a
  vulnerability.
- **A fixer or suggestion that changes what code does.** An autofix is applied by
  `eslint --fix` without review. A fix that silently alters semantics is a defect in this repo,
  not in the consumer's.
- **The published artefacts.** Every package publishes from
  `.github/workflows/release.yml` with npm provenance, and every action in the workflows is
  pinned to a commit SHA. A tarball on npm that does not match the tagged source, or a way to
  make the release workflow publish something else, is a vulnerability.
- **Denial of service on the lint run.** Catastrophic backtracking in a rule's regex, or a rule
  that hangs on a crafted file, is worth a private report if the input is something a
  contributor to the linted repo could plant.

## What does not count

- **A rule in `@noctcore/eslint-plugin-security` that misses something.** `no-shell-interpolation`,
  `no-user-controlled-fetch-url`, `no-user-controlled-redirect`, `require-path-containment` and
  `server-action-through-client` are high-precision syntactic checks, documented as such. A
  shape they do not catch is a **false negative** in this repo and a bug in the code they were
  run on. File it publicly with the false negative issue form; the code it failed to flag is
  yours, not ours, and nobody is exposed by discussing the pattern.
- **A false positive**, however loud. Public issue.
- **Advisories in the dev toolchain** (`tsup`, `vitest`, the changesets CLI). None of it ships in
  a published `dist/`. Send them as a normal issue or a PR bumping the lockfile.

## Reporting

Use GitHub's private vulnerability reporting for this repository:
<https://github.com/noctcore/eslint-plugins/security/advisories/new>. It opens a draft advisory that
only the maintainer can see.

If that page says reporting is not enabled, the setting has not been switched on yet. Open a
regular issue whose entire body is "security report, need a private channel", with no details,
and the maintainer will reply with one. Do not put the finding in a public issue.

Include the package and version, the input that triggers it, and what it does. There is no
bounty. You will get a reply from the maintainer, a fix as a `patch` release with a changelog
entry that credits you unless you ask otherwise, and the details published once the fix is on
npm.

## Supported versions

Only the latest release of each package. Every package is `0.x`; fixes ship forward, never as a
backport.
