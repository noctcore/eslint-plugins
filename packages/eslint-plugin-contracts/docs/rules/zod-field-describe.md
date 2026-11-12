# `noctcore-contracts/zod-field-describe`

> Every property of a zod object schema carries a description.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A zod field description is the documentation that travels with the schema. It becomes the
`description` of the JSON Schema a docs or tool-definition generator emits, the hint a model sees for
a tool argument, and the text an API reference shows beside the field. A field without one is silent
in all three, and nothing fails at runtime to say so.

## What it flags

Every property of a `z.object` / `z.strictObject` / `z.looseObject` shape, and of the shape passed to
`.extend` / `.safeExtend`, whose value chain has no `.describe('...')` with non-empty text and no
`.meta({ description: '...' })`. The description may sit anywhere in the chain, so
`z.string().describe('x').min(1)` and `z.string().min(1).describe('x')` both pass. The check is per
property: a `.describe()` on the enclosing object does not cover its fields. An empty or blank
description counts as missing.

```ts bad reports=4
export const UserSchema = z.object({
  id: z.string().describe('Stable identifier'),
  name: z.string().min(1),
  email: z.string().email().describe(''),
  age: z.number().meta({ title: 'Age' }),
  tags: z.array(z.string()).optional(),
});
```

```ts good
export const UserSchema = z.object({
  id: z.string().describe('Stable identifier'),
  name: z.string().min(1).describe('Display name'),
  email: z.string().email().describe('Contact address'),
  age: z.number().meta({ description: 'Age in years' }),
  tags: z.array(z.string()).optional().describe('Free-form labels'),
});
```

## What it does not flag

- A field whose value is a reference to another schema (`user: UserSchema`, `user: Schemas.User`,
  `user: UserSchema.optional()`) while `allowSchemaReferences` is `true`: that schema carries its own
  description.
- A description or `meta` argument that is computed (`.describe(TEXT.name)`, a template with
  expressions, `.meta(base)`, `.meta({ ...base })`): the rule cannot read it, so it trusts it.
- Spread entries and values that are not a zod chain or a schema reference, such as a conditional.
- Schemas built from a namespace not listed in `zodIdentifiers`, and any `z.object(shape)` whose
  shape is not an object literal.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `zodIdentifiers` | `string[]` | `['z']` | Names zod is imported under. |
| `allowSchemaReferences` | `boolean` | `true` | Do not report a field whose value is a reference to another schema. |

Set `allowSchemaReferences: false` to require a description at every use site, including references:

```js
'noctcore-contracts/zod-field-describe': ['error', { allowSchemaReferences: false }]
```

Scope the rule to your schema modules with the config block's `files` (for example
`files: ['**/*.schemas.ts']`); the rule itself assumes no layout.

## When not to use it

If your schemas are never turned into JSON Schema, tool definitions or API docs, a description on
every field is ceremony. Leave the rule off, or enable it only for the modules that feed a generator.
