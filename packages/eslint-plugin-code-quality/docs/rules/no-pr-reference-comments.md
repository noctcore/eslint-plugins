# `noctcore-code-quality/no-pr-reference-comments`

> PR/issue references belong in commit messages, not in source comments.

## Why

`// fixes #123` or a link to a pull request rots the moment the repo moves, the issue tracker
migrates, or the numbering changes — and it drags the reader out of the code to chase context that a
`git blame` already carries. The git log and PR description are the canonical, durable home for
repo-history references.

## What it flags

Comments containing:

- a GitHub PR/issue URL (`https://github.com/owner/repo/pull/42`, `.../issues/42`);
- an action reference (`see`/`closes`/`fixes`/`resolves`/`refs` `#123`);
- a `PR #123` / `PR 123` reference;
- a bare `#123` at a word boundary.

```ts
// ✗ fixes #123
// ✗ See https://github.com/noctcore/eslint-plugins/pull/42 for context.
// ✗ workaround (#88)

// ✓ Trust-proxy depth for single-host Traefik.
const channel = "#general"; // ✓ not a comment
```

## Options

None.

## When not to use it

If your workflow relies on inline issue links in code.
