---
'@noctcore/eslint-plugin-llm': minor
---

New package: rules for code that calls LLM SDKs. First rule, `no-llm-output-to-sink`, in `recommended` at `error`.

It reports text returned by an awaited OpenAI (`chat.completions.create`, `responses.create`), Anthropic (`messages.create`, including a `tool_use` block's `input`) or Vercel AI SDK (`generateText`, `generateObject` from `ai`) call when it reaches `eval`, `new Function`, a `child_process` shell, Prisma's `$queryRawUnsafe` / `$executeRawUnsafe`, `innerHTML` / `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, the origin of a `fetch` URL or an `fs` path in the same function (OWASP LLM05, Improper Output Handling). It follows `const` bindings and destructuring only, and stays silent once the value goes through a sanitizer, a schema `.parse`, a helper call, a parameter or a `let`, so it needs no configuration. This is a new package, so no existing build changes until you install it and spread `recommended`.
