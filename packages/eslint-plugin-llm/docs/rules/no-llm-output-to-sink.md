# `noctcore-llm/no-llm-output-to-sink`

> Text an LLM SDK call returned must not reach `eval`, a shell, raw SQL, HTML injection, a `fetch` origin or an `fs` path without being validated or sanitized first.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A model writes whatever its prompt steers it toward, and the prompt holds more than your
instructions: the user's message, a retrieved web page, a document from the index, the result of
the last tool call. Any of those can carry a prompt injection. So the model's output is untrusted
input, exactly like a request body, and the damage it can do is set by where you send it. This is
[OWASP Top 10 for LLM Applications 2025, LLM05 "Improper Output Handling"](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/):
model output passed to a browser becomes XSS, to a shell becomes remote code execution, to SQL
becomes injection, to a URL becomes SSRF, to a path becomes traversal.

```ts bad
async function explain(openai, messages, panel) {
  const res = await openai.chat.completions.create({ model: 'gpt-4o', messages });
  // a summarised page that said "reply with <img src=x onerror=...>" now runs in your origin
  panel.innerHTML = res.choices[0].message.content ?? '';
}
```

The fix depends on what the output is for. Text for a person goes through `textContent` (or JSX
children, which React escapes), or through a sanitizer when it really must be HTML:

```ts good
async function explain(openai, messages, panel) {
  const res = await openai.chat.completions.create({ model: 'gpt-4o', messages });
  panel.textContent = res.choices[0].message.content ?? '';
}
```

Output meant to drive code is parsed against a schema first, so only the shapes you allow get
through, and then used through an API that does not re-parse strings:

```ts bad
import { exec } from 'node:child_process';

async function runPlan(anthropic, messages) {
  const msg = await anthropic.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages });
  for (const block of msg.content) {
    if (block.type === 'tool_use') exec(block.input.command);
  }
}
```

```ts good
import { execFile } from 'node:child_process';

async function runPlan(anthropic, messages) {
  const msg = await anthropic.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages });
  for (const block of msg.content) {
    if (block.type === 'tool_use') {
      const { tool, args } = AllowedCommand.parse(block.input);
      execFile(tool, args);
    }
  }
}
```

### Why it is in `recommended`

It is precise without configuration. A report needs three things at once: an awaited call whose
method chain or import is specific to an LLM SDK, the exact response path that carries model text,
and a sink that interprets its argument as code, markup, SQL, a host or a path. Code that has all
three and is still correct is rare, and when it exists (a trusted internal model, a sandboxed
`eval`) a disable comment that says so is the right record.

The trade-off is coverage: output that leaves the function, or goes through a helper, is not
followed. Interlace's
[`eslint-plugin-vercel-ai-security`](https://www.npmjs.com/package/eslint-plugin-vercel-ai-security)
has a broader `no-unsafe-output-handling`: it treats any expression whose source text contains
`.text`, `completion` or `generated` as model output, and any callee whose text contains `exec`,
`query` or `run` as a sink, in files that import the AI SDK. That reaches further and also reports
`regex.exec(input.text)` or `db.run(completionCount)`. This rule takes the other side of that trade,
the shape of a real SDK response instead of a name, so it can run at `error`.

## What it flags

The rule reports only when the whole path from the SDK call to the sink is visible in the source.

**Sources.** The result of an `await`ed call, followed through `const` bindings, destructuring,
`for (const x of ...)`, optional chaining, `??`, `||`, ternaries, `+`, template literals, `trim()`
and friends, `String(...)` and `JSON.parse(...)`:

| SDK | Call | Model output |
| --- | --- | --- |
| OpenAI | `<client>.chat.completions.create(...)` / `.parse(...)` | `.choices[i].message.content` |
| OpenAI | `<client>.responses.create(...)` | `.output_text` |
| Anthropic | `<client>.messages.create(...)` | `.content[i].text`, and a `tool_use` block's `.input` |
| Vercel AI SDK | `generateText(...)` imported from `ai` | `.text`, `{ text }` |
| Vercel AI SDK | `generateObject(...)` imported from `ai` | `.object` and everything in it |

An element is picked with `[i]`, `.at(i)`, `.find(...)` or `.findLast(...)`, and `.filter(...)`
keeps the array.

**Sinks.**

- `eval(...)` and `new Function(...)`.
- `child_process` `exec` / `execSync` (always a shell), and `spawn` / `spawnSync` / `execFile` /
  `execFileSync` with `shell: true`, when the function comes from an `import` or `require` of
  `child_process`, directly or through `promisify`.
- The SQL text of Prisma's `$queryRawUnsafe` / `$executeRawUnsafe`.
- `innerHTML` / `outerHTML` assignment, `insertAdjacentHTML`, `document.write`, and JSX
  `dangerouslySetInnerHTML={{ __html }}`.
- The URL of `fetch`, when the model output sits where it can choose the host.
- The path arguments of `fs` functions (`readFile`, `writeFile`, `unlink`, `rm`, `rename`, ...),
  from `fs`, `fs.promises` or `fs/promises`.

```ts bad
import { generateText } from 'ai';

async function lookup(model, prompt) {
  const { text } = await generateText({ model, prompt });
  return fetch(`https://${text}/v1/status`);
}
```

```ts good
import { generateText } from 'ai';

async function lookup(model, prompt) {
  const { text } = await generateText({ model, prompt });
  return fetch(`https://status.example.com/v1/lookup?q=${encodeURIComponent(text)}`);
}
```

```ts bad
async function report(openai, prisma, messages) {
  const res = await openai.chat.completions.create({ model: 'gpt-4o', messages });
  const sql = res.choices[0].message.content ?? '';
  return prisma.$queryRawUnsafe(sql);
}
```

## What it does not flag

Staying silent is the default. Each of these ends the chain, so none is reported:

```ts good
import { writeFile } from 'node:fs/promises';

async function answer(openai, messages, panel) {
  const res = await openai.chat.completions.create({ model: 'gpt-4o', messages });
  const text = res.choices[0].message.content ?? '';

  panel.textContent = text;                                   // not parsed as HTML
  panel.innerHTML = DOMPurify.sanitize(text);                 // a call the rule does not see through
  const plan = Plan.parse(JSON.parse(text));                  // a schema parse
  await writeFile('out/answer.md', text);                     // file contents, not a path
  await fetch(`https://api.example.com/notes?q=${text}`);     // the origin is already fixed
  await prisma.$queryRawUnsafe('SELECT 1 WHERE $1 = $1', text); // a bound parameter
  return { plan, text };
}
```

- Any `.content` that no recognised SDK call produced: a CMS page, a fetched JSON body, a database
  row.
- A value passed in as a parameter, held in a `let`, or returned from any helper. The rule does not
  follow calls or reassignments, so a model result that crosses a function boundary is not seen.
- An SDK call that is not awaited where the result is bound, and a `generateText` imported from
  anywhere other than `ai`.
- `regex.exec(text)`, a local function named `exec`, and `spawn` / `execFile` without a shell.
- `path.join(root, text)` and every other transform besides the ones listed above.

## When not to use it

If your code never calls an LLM SDK, it does nothing. If you deliberately execute model output
inside a real sandbox (a separate process with no credentials, a WebAssembly runtime), disable it
on that line and say why in the comment.
