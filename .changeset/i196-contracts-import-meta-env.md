---
'@noctcore/eslint-plugin-contracts': minor
---

`no-direct-process-env` gains a `sources` option. Its values are `process.env` and `import.meta.env`, and it defaults to `['process.env']`, so existing configs behave exactly as before. With `import.meta.env` listed, the rule reports dot access, `import.meta['env']`, destructuring and bare reads, and never reports Vite's build constants `MODE`, `DEV`, `PROD`, `SSR` and `BASE_URL`. The report message now names the source that was read, with identical text under the default. A project spreading `recommended` sees no new errors.
