# `noctcore-contracts/schema-enum-field-consistency`

> A field that is an enum in one zod object schema must not be `z.string()` in another schema of the
> same module.

## Why

When schemas double as wire types (tRPC procedures, a shared contract package), the output schema is
the type the client imports. If a field is an enum on the inputs but `z.string()` on the output, the
widened type leaks `string` to every consumer, which then narrows or casts by hand. Each schema is
correct on its own, so neither the compiler nor review catches it.

## What it flags

Per file, purely syntactic, no type information. The rule collects every property of every
`z.object` / `z.strictObject` / `z.looseObject` and every `.extend` / `.safeExtend` shape, unwraps
`.optional()`, `.nullable()`, `.nullish()`, `.default()`, `.prefault()`, `.catch()`, `.describe()`,
`.meta()` and `.readonly()`, and classifies each value:

- **enum**: `z.enum(...)`, `z.nativeEnum(...)`, a `z.union` of only `z.literal`s, a multi-value
  `z.literal([...])`, `.extract()` / `.exclude()` of an enum, or an identifier whose same-file
  declaration is one of those (or an import matching `enumIdentifierPattern`)
- **string**: a chain rooted at `z.string()` with no `.pipe()` or `.transform()`
- anything else is ignored, including `z.union([z.string(), z.null()])`

Every **string** occurrence of a key that is **enum** elsewhere in the file is reported. No autofix:
the right fix may be a data migration (the stored column was free text), not a schema edit.

```ts
// ✗ the output widens what both inputs narrow
export const statusSchema = z.enum(['OPEN', 'CLOSED']);

export const ticketCreateInput = z.object({ status: statusSchema.default('OPEN') });
export const ticketUpdateInput = z.object({ status: statusSchema.optional() });
export const ticketOutput = z.object({
  id: z.string(),
  status: z.string().nullable(),
});
```

```ts
// ✓ the output reuses the enum
export const ticketOutput = z.object({
  id: z.string(),
  status: statusSchema.nullable(),
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `zodIdentifiers` | `string[]` | `['z']` | Names zod is imported under. |
| `ignoreFields` | `string[]` | `[]` | Keys that genuinely mean different things in two schemas. |
| `enumIdentifierPattern` | `string` (regex source) | unset | An imported identifier counts as an enum only when its name matches. |

Imported identifiers are **not** assumed to be enums by default, so `email: emailSchema` (a string
schema from another module) is not flagged against `email: z.string()`. If your project names its
enum schemas consistently, opt them in:

```js
'noctcore-contracts/schema-enum-field-consistency': ['error', {
  zodIdentifiers: ['z'],
  enumIdentifierPattern: '(Status|Kind|Role)Schema$',
  ignoreFields: ['type'],
}]
```

Scope the rule to your schema modules with the config block's `files` (for example
`files: ['src/schemas/**/*.ts']`); the rule itself assumes no layout.

## When not to use it

If a module intentionally keeps free-text and enum variants of the same key (a legacy import format
beside the validated one), list that key in `ignoreFields` rather than turning the rule off.
