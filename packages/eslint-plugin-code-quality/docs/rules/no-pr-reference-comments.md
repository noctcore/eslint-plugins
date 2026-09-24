# `noctcore-code-quality/no-pr-reference-comments`

> PR/issue references belong in commit messages, not in source comments.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

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

```ts bad reports=3
// fixes #123
// See https://github.com/noctcore/eslint-plugins/pull/42 for context.
// workaround (#88)
```

```ts good
// Trust-proxy depth for single-host Traefik.
const channel = "#general"; // the string is not a comment
```

## What it does not flag

- Strings and other code: only comments are read, so `"#general"` in a literal is fine.
- A `#` followed by anything but digits (`#general`, `#fff`), or digits glued to a preceding word
  (`step#2`): a bare reference needs whitespace, `(` or the start of the comment before the `#`.
- Prose that points at a guide or document rather than a numbered issue
  (`// See the expressjs proxies guide for the rationale.`).

## When not to use it

If your workflow relies on inline issue links in code.
