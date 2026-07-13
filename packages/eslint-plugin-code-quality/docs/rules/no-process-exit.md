# `noctcore-code-quality/no-process-exit`

> `process.exit()` belongs to bootstrap/shutdown and CLIs — not application code.

## Why

`process.exit()` kills the whole process immediately, skipping pending I/O, `finally` blocks, and
graceful-shutdown handlers. In request-scoped, service, or renderer code that is a footgun: a single
call can take the entire process down mid-flight. Those layers should `throw` or reject and let the
lifecycle decide how to tear down. The legitimate exit sites are standalone scripts, CLI entrypoints,
and config files.

## What it flags

Any `process.exit(...)` call in a file **not** covered by `allowIn`. Both the dot form
(`process.exit()`) and the computed form (`process['exit']()`) are caught so a computed callee
cannot bypass the rule.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | see below | File-path globs where `process.exit()` is allowed. |

The globs are matched against the file path (a leading `**/` may match zero leading directories, so
the same pattern works for absolute and project-relative paths). Default:

```jsonc
["**/scripts/**", "**/bin/**", "**/cli/**", "**/*.config.{ts,js,mjs,cjs,cts,mts}"]
```

```js
'noctcore-code-quality/no-process-exit': ['error', { allowIn: ['**/scripts/**', '**/*.cli.ts'] }]
```

## When not to use it

Standalone CLI projects where every file is legitimately an entrypoint.
