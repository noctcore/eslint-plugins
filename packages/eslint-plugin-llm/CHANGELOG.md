# @noctcore/eslint-plugin-llm

## 0.1.0

### Minor Changes

- [#19](https://github.com/noctcore/eslint-plugins/pull/19) [`0c26d50`](https://github.com/noctcore/eslint-plugins/commit/0c26d50f109843c9232c79d7349d023b775922c6) Thanks [@Shironex](https://github.com/Shironex)! - New package: rules for code that calls LLM SDKs. First rule, `no-llm-output-to-sink`, in `recommended` at `error`.

  It reports text returned by an awaited OpenAI (`chat.completions.create`, `responses.create`), Anthropic (`messages.create`, including a `tool_use` block's `input`) or Vercel AI SDK (`generateText`, `generateObject` from `ai`) call when it reaches `eval`, `new Function`, a `child_process` shell, Prisma's `$queryRawUnsafe` / `$executeRawUnsafe`, `innerHTML` / `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, the origin of a `fetch` URL or an `fs` path in the same function (OWASP LLM05, Improper Output Handling). It follows `const` bindings and destructuring only, and stays silent once the value goes through a sanitizer, a schema `.parse`, a helper call, a parameter or a `let`, so it needs no configuration. This is a new package, so no existing build changes until you install it and spread `recommended`.
