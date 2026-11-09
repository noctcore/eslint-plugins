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
- a bare `#123` at a word boundary: two or more digits, no leading zero, not followed by `%` or a letter;
- a tracker key matching one of the `trackerPatterns` you configure (none by default).

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
- A one-digit number (`step #2 of the wizard`), a hex colour or number with a leading zero
  (`#000 at 50%`), and a percentage (`#40%`).
- Jira or Linear keys (`ABC-123`), unless you list a pattern for them in `trackerPatterns`. A generic
  `[A-Z]+-\d+` would also match `UTF-8`, so name your project keys.
- Prose that points at a guide or document rather than a numbered issue
  (`// See the expressjs proxies guide for the rationale.`).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `trackerPatterns` | `string[]` (regex sources) | `[]` | Extra tracker-key patterns to report, matched at word boundaries with the `u` flag. |

```js
// Also report Jira keys for the OPS and WEB projects.
'noctcore-code-quality/no-pr-reference-comments': ['error', { trackerPatterns: ['(?:OPS|WEB)-\\d+'] }]
```

## When not to use it

If your workflow relies on inline issue links in code.
