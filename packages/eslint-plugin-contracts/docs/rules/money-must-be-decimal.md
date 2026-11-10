# `noctcore-contracts/money-must-be-decimal`

> Monetary fields typed as the JS `number` primitive lose precision to float rounding — use a Decimal money type.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Money stored as a JS `number` accumulates IEEE-754 rounding errors (`0.1 + 0.2 !== 0.3`), which is
unacceptable for accounting figures. This rule is a **dormant guard**: it stays green on a codebase
with no money fields and lights up the moment a money-named field is introduced with the wrong type.

## What it flags

A field whose name matches the money pattern **and** is explicitly annotated `: number` (alone, or
with `| null` / `| undefined`), in the positions that carry real precision risk:

- class properties: `class Invoice { total: number }`
- annotated variable declarators: `const amount: number = …`
- a money-named key typed `z.number()` in a `z.object({...})` (turn off with `checkZod: false`)
- opt-in: interface and type-literal members (`checkTypeMembers: true`) and function parameters
  (`checkParameters: true`)

A name with a counter word is a count, not money: `totalPages`, `totalCount`, `priceIndex`,
`total_items` (see `counterWords`). A bare `total` on a pagination-shaped class or type (its name
contains `Page`, `Paginat`, `Pager` or `Cursor`, as in `PageMetaDto`) is the item count and is
skipped too.

```ts bad reports=2
class Invoice { total: number; }
const amount: number = 5;
```

```ts good
class Invoice { total: Decimal; }
const count: number = 3;          // not a money name
interface Payment { amount: number; }   // type member, out of scope
```

## What it does not flag

Conservative on purpose. Untyped declarations and numeric-literal initializers (`let total = 0`) are
**not** flagged — those are usually counters/accumulators. Interface and type-literal members
(`{ amount: number }`) and function parameters are **opt-in** so non-money type members do not
regress for projects that have not asked for them.

- Object-literal properties (`const x = { total: 5 }`), except a key of a `z.object({...})`.
- Counts and pagination totals: `class PageMetaDto { total: number; totalPages: number }`.
- Fields matching `minorUnitPatterns`, and every field in a file listed in `allowIn`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `decimalType` | `string` | `'Decimal'` | Name of the money type to require; appears in the report message. |
| `fieldPatterns` | `string[]` | `['amount', 'price', 'cost', 'total', 'balance']` | Case-insensitive regex fragments identifying money-named fields (OR-combined). |
| `allowIn` | `string[]` | `[]` | Files skipped entirely, as globs (`**/legacy/**`). A plain path is a path suffix matched at a directory boundary (`apps/api/src/legacy/totals.ts`). |
| `allowedFiles` | `string[]` | (none) | Deprecated alias of `allowIn`, kept through 1.x. When both are set, their globs are combined. |
| `minorUnitPatterns` | `string[]` | `[]` | Case-insensitive regex fragments naming fields that hold integer minor units on purpose and are therefore not reported. Checked before `fieldPatterns`. |
| `counterWords` | `string[]` | `['count', 'counts', 'pages', 'page', 'items', 'rows', 'records', 'results', 'index', 'idx', 'hits', 'num', 'number']` | Whole name words (camelCase, snake_case or kebab-case, case-insensitive) that mark a count. A money-named field with one of them is not reported. |
| `checkZod` | `boolean` | `true` | Check `z.number()` under a money-named key of `z.object({...})`. |
| `zodIdentifiers` | `string[]` | `['z']` | Zod namespace identifiers, for a renamed import. |
| `checkTypeMembers` | `boolean` | `false` | Also check interface and type-literal members. |
| `checkParameters` | `boolean` | `false` | Also check function parameters. |

```js
'noctcore-contracts/money-must-be-decimal': ['error', {
  decimalType: 'Money',
  fieldPatterns: ['amount', 'price', 'discount', 'vat'],
}]
```

### Talking to a payment API

Stripe and most payment APIs deal in integer minor units: `amount` is a number of cents, and that
is correct at that boundary. Without `minorUnitPatterns` this rule flags every one of those
fields, which is how a project ends up turning the rule off entirely and losing it everywhere
else.

Name the boundary fields instead, so the rule keeps policing the rest of the codebase:

```json
{ "minorUnitPatterns": ["amountInCents", "unitAmount", "^amount$"] }
```

Prefer patterns that are specific to the boundary. A blanket `amount` would exempt every field
whose name contains it, including the internal totals this rule exists to protect.

## When not to use it

If your project has no dedicated Decimal money type, this rule does not fit.

If it represents money as integer minor units **everywhere**, by choice, the rule can still be
useful with `minorUnitPatterns` covering that convention, but at that point it is asserting a
naming convention rather than a type, and you may not want it.
