# `noctcore-code-quality/typed-mock-over-double-cast`

> An object of mocks must be typed against the real interface, not double-cast past the checker.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`{ get: jest.fn() } as unknown as ConfigService` tells TypeScript to stop checking. When the real
service renames `get` to `getOrThrow`, the test still mocks `get`, the code under test calls
`getOrThrow` on an object that does not have it, and the failure (if the test fails at all) is a
`TypeError` far from the cause. Worse, a mock that returns the wrong shape keeps compiling forever.

Type the double against the members the test uses. `jest.Mocked<Pick<T, 'a' | 'b'>>` (or Vitest's
`Mocked<Pick<...>>`) keeps every mocked member checked against `T`, and `satisfies Partial<T>`
checks the literal without widening it.

```ts bad filename=src/metrics/basic-auth.guard.spec.ts
const config = {
  get: jest.fn((key: string) => (key === 'METRICS_BASIC_AUTH' ? basicAuth : undefined)),
} as unknown as ConfigService;
```

```ts good filename=src/metrics/basic-auth.guard.spec.ts
const config: jest.Mocked<Pick<ConfigService, 'get'>> = {
  get: jest.fn((key: string) => (key === 'METRICS_BASIC_AUTH' ? basicAuth : undefined)),
};
```

## What it flags

An object literal cast `as unknown as T` (or `as any as T`) that contains a mock-function call
(`jest.fn()` / `vi.fn()` by default) anywhere inside it: as a property, nested in another object,
at the start of a chain (`jest.fn().mockResolvedValue(...)`) or inside a function property.

```ts bad filename=src/common/rate-limit.spec.ts reports=2
const opts = { ctx: { res: { setHeader: jest.fn() } } } as unknown as OnErrorOptions;

const host = {
  switchToHttp: () => ({ getResponse: () => ({ status: jest.fn() }) }),
} as unknown as ArgumentsHost;
```

```ts good filename=src/common/rate-limit.spec.ts
const opts = { ctx: { res: { setHeader: jest.fn() } } } satisfies DeepPartial<OnErrorOptions>;

const host: jest.Mocked<Pick<ArgumentsHost, 'switchToHttp'>> = {
  switchToHttp: jest.fn(() => ({ getResponse: () => ({ status: jest.fn() }) })),
};
```

## What it does not flag

- A single cast (`as jest.Mocked<Pick<T, 'get'>>`): TypeScript still checks that the two types
  overlap.
- A double cast of an object with no mock in it (a data fixture), or of something that is not an
  object literal (`existingDouble as unknown as T`).
- `as unknown` on its own.
- A target matching `allowTargets`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mockFactories` | `string[]` | `["jest.fn", "vi.fn"]` | Callees that create a mock function, as `name` or `obj.name`. |
| `allowTargets` | `string[]` (globs) | `[]` | Cast targets that may be double-cast, matched against the type name (`PrismaService`, `Prisma.TransactionClient`) and the full type text (`Parameters<Guard['canActivate']>[0]`). For types too wide to `Pick` from. |

```js
'noctcore-code-quality/typed-mock-over-double-cast': ['error', {
  // An ORM client and its transaction are too wide to Pick from.
  allowTargets: ['PrismaService', 'Prisma.TransactionClient'],
}]
```

```ts good filename=src/metrics/basic-auth.guard.spec.ts reconfigured options={"allowTargets":["PrismaService"]}
const prisma = { user: { findMany: jest.fn() } } as unknown as PrismaService;
```

## When not to use it

In a codebase without strict types in its tests, where a double cast is the norm and a typed double
would need a helper type library first.

## Related

- [`no-vacuous-expect`](./no-vacuous-expect.md): assertions that pass for almost any implementation.
