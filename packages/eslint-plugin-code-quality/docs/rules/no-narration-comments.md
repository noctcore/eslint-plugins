# `noctcore-code-quality/no-narration-comments`

> Ban step-by-step "Now we… / First we…" narration comments.

## Why

Comments like "Here we attach the user" or "First, we parse the cookies" restate what the next line
of code already says. They add no information a reader can't get from the code and are a frequent tell
of a comment generated to narrate a change. Describe the **why** when a comment is warranted, or
delete it.

## What it flags

Line and block comments (JSDoc `/** … */` blocks are exempt) that **begin** with a narration
construction: `here we`, `now we`, `first[,] we`, `then[,] we`, `next[,] we`, `finally[,] we`,
`let's`, `let me`.

A bare leading word ("Next attempt…", "First run…") is fine — only the "we"/"let's" narration form matches.

```ts
// ✗ Now we attach the user to the socket.
// ✗ Let's validate the session token.

// ✓ WHY: Prisma reuses the pooled connection across requests.
// ✓ call next() to continue the middleware chain
```

## Options

None.

## When not to use it

If your team writes tutorial-style narrated code on purpose.
