# `noctcore-async-safety/no-shared-mutable-module-state`

> A module-scoped mutable binding written from an exported async/handler function or an exported class method is shared across concurrent requests.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

On a server, module scope is process-wide: every concurrent request runs against the same module-level
variables. A `let` counter or a `const cache = new Map()` written inside a request handler is not per-request
state — request B observes and overwrites what request A left behind. This leaks data across users and produces
races that never appear in single-request local testing.

## What it flags

Only when the file matches an `include` glob (see Options — the rule is **off by default**), a write to a
module-scoped mutable binding performed inside an **exported async function**, a **handler-named export**, or
any **method of an exported class**:

- a module-level `let`/`var` reassigned (`x = …`, `x += …`, `x++`); or
- a module-level mutable container `const` (`[]`, `{}`, `new Map()`/`Set()`/`WeakMap()`/`WeakSet()`) mutated
  (`c.push(…)`, `c.set(…)`, `c[i] = …`, `c.prop = …`).

Exported functions qualify when they are `async` or named like a handler (`GET`/`POST`/…, `loader`, `action`,
`handler`, `*Handler`, `middleware`).

```ts bad filename=src/server/metrics.ts options={"include":["**/server/**"]}
// shared across requests
let requestCount = 0;
export async function GET() {
  requestCount += 1;
}
```

```ts good filename=src/server/metrics.ts options={"include":["**/server/**"]}
// per-request
export async function GET() {
  const requestCount = 1;
}
```

### Class methods

In a DI framework one instance of a provider serves every request (a NestJS `@Injectable()` is a
singleton by default), so every method of an exported class is an entry point, `async` or not. The
constructor is skipped: it runs once, when the provider is wired. A declaration exported by a later
`export { Name }` or `export default Name` counts like an inline export.

```ts bad filename=src/server/tenant.service.ts options={"include":["**/server/**"]}
const seen = new Set<string>();

@Injectable()
export class TenantService {
  remember(tenantId: string) {
    seen.add(tenantId);
  }
}
```

```ts good filename=src/server/tenant.service.ts options={"include":["**/server/**"]}
@Injectable()
export class TenantService {
  private readonly seen = new Set<string>();

  remember(tenantId: string) {
    this.seen.add(tenantId);
  }
}
```

Moving the state onto the instance makes the sharing visible in the class, which is where a reader
looks for it; whether the provider should hold it at all is still your call.

## What it does not flag

- Anything, until `include` is set, and any file outside the `include` globs.
- The lazy-initialization idioms `x ??= …` and `x ||= …` (the common singleton/memoization pattern), and
  names in `allow`.
- A write inside a non-exported helper or class, or inside an exported function that is neither `async`
  nor handler-named.
- `this.x` instance state on a class, which is not a module binding, and writes in a constructor.
- A module-level `const` that is only read.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` (globs) | `[]` | Glob patterns for server files to arm the rule on. Empty = the rule does nothing. |
| `allow` | `string[]` | `[]` | Binding names to exempt (intentional singletons / process-wide caches). |

Globs support `**` (any run including `/`), `*` (any run except `/`), `?`, `{a,b}`, and a leading `**/` that
also matches zero leading segments. They are matched against the file's absolute path and its path
relative to the working directory and to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), so `apps/api/**` and `**/server/**` both work.

```js
'noctcore-async-safety/no-shared-mutable-module-state': [
  'error',
  { include: ['**/server/**', '**/*.server.ts'], allow: ['metricsRegistry'] },
]
```

## When not to use it

Client-side modules legitimately hold shared mutable state (caches, stores, singletons). Keep `include` scoped
to server code so those are never touched.
