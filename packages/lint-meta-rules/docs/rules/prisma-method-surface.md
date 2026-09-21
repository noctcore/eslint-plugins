# `prisma-method-surface`

> The Prisma reads and writes your rules police partition the generated client's `<Model>Delegate`
> method surface exactly, so a Prisma upgrade cannot add an unguarded method.

Import it from the `prisma` entry point:

```ts
import { createPrismaMethodSurfaceRule } from '@noctcore/lint-meta-rules/prisma';
```

## Why

Rules that guard Prisma calls by method name (tenant fences, single-writer fences, transaction
rules) read a hand-written list of methods. The list falls behind the client: Prisma adds a method
(`createManyAndReturn` and `updateManyAndReturn` both arrived this way), nobody edits the list, and
the new method is invisible to every fence at once. It reads like ordinary code, not like evasion,
which is what makes the gap dangerous.

This reads the GENERATED client, which changes the moment Prisma is upgraded, and asserts the
configured reads and writes are exactly its delegate surface.

## What it flags

- a delegate method that is neither a configured read nor a configured write (the upgrade case);
- a configured method the client no longer exposes;
- a delegate whose method surface differs from the others (the lists are model-agnostic);
- a method configured as both a read and a write.

It **fails closed**: no generated client under `clientGlobs` is a violation, because a checkout that
never ran `prisma generate` is exactly where drift hides. Run `prisma generate` before lint-meta.

Members are read line by line: a delegate method is a generic, `name<T ...>(...)`, at the interface's
member indentation. `fields`, the symbol brand and `$`-prefixed members are not query methods.

## Factory

```ts
createPrismaMethodSurfaceRule(options?: PrismaMethodSurfaceOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'prisma-method-surface'` | Rule id. |
| `clientGlobs` | `string[]` | `['generated/prisma/models/*.ts', 'node_modules/.prisma/client/index.d.ts']` | Generated client files declaring the delegates: the `prisma-client` generator's per-model files, or the `prisma-client-js` generator's single `index.d.ts`. Point it at your generator's `output`. |
| `writeMethods` | `string[]` | `PRISMA_WRITE_METHODS` from `@noctcore/eslint-plugin-prisma` | The methods your rules police as writes. |
| `readMethods` | `string[]` | `PRISMA_READ_METHODS` from `@noctcore/eslint-plugin-prisma` | The methods your rules know to be reads. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

With the defaults, the rule checks the exact lists `@noctcore/eslint-plugin-prisma`'s rules read.
If your own rules read their own lists, pass those.

## Worked example: Settly

Settly's schema generates into `packages/database/generated/prisma` with the `prisma-client`
generator:

```ts
createPrismaMethodSurfaceRule({
  clientGlobs: ['packages/database/generated/prisma/models/*.ts'],
});
```

Adding a method to every generated delegate reports it as unguarded; adding it to one model only
reports that delegate as divergent; removing the generated folder reports that no client was found.
