# `noctcore-code-quality/no-narration-comments`

> Ban step-by-step "Now we… / First we…" narration comments.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Comments like "Here we attach the user" or "First, we parse the cookies" restate what the next line
of code already says. They add no information a reader can't get from the code and are a frequent tell
of a comment generated to narrate a change. Describe the **why** when a comment is warranted, or
delete it.

## What it flags

Line and block comments that **begin** with a narration
construction: `here we`, `now we`, `first[,] we`, `then[,] we`, `next[,] we`, `finally[,] we`,
`let's`, `let me`.

```ts bad reports=2
// Now we attach the user to the socket.
// Let's validate the session token.
```

```ts good
// WHY: Prisma reuses the pooled connection across requests.
// call next() to continue the middleware chain
```

## What it does not flag

- JSDoc `/** … */` blocks.
- A bare leading word ("Next attempt…", "First run…") — only the "we"/"let's" narration form matches.
- A narration word mid-sentence (`// call next() to continue the middleware chain`): the phrase must
  open the comment.

## When not to use it

If your team writes tutorial-style narrated code on purpose.
