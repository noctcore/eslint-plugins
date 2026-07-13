# `noctcore-contracts/money-must-be-decimal`

> Monetary fields typed as the JS `number` primitive lose precision to float rounding — use a Decimal money type.

## Why

Money stored as a JS `number` accumulates IEEE-754 rounding errors (`0.1 + 0.2 !== 0.3`), which is
unacceptable for accounting figures. This rule is a **dormant guard**: it stays green on a codebase
with no money fields and lights up the moment a money-named field is introduced with the wrong type.

## What it flags

A field whose name matches the money pattern **and** is explicitly annotated `: number`, in the two
positions that carry real precision risk:

- class properties — `class Invoice { total: number }`
- annotated variable declarators — `const amount: number = …`

Conservative on purpose. Untyped declarations and numeric-literal initializers (`let total = 0`) are
**not** flagged — those are usually counters/accumulators. Interface and type-literal members
(`{ amount: number }`) are **out of scope** so non-money type members do not regress.

```ts
// ✗
class Invoice { total: number; }
const amount: number = 5;

// ✓
class Invoice { total: Decimal; }
const count: number = 3;          // not a money name
interface Payment { amount: number; }   // type member, out of scope
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `decimalType` | `string` | `'Decimal'` | Name of the money type to require; appears in the report message. |
| `fieldPatterns` | `string[]` | `['amount', 'price', 'cost', 'total', 'balance']` | Case-insensitive regex fragments identifying money-named fields (OR-combined). |
| `allowedFiles` | `string[]` | `[]` | Path-suffix allowlist of files skipped entirely (e.g. `apps/api/src/legacy/totals.ts`). |

```js
'noctcore-contracts/money-must-be-decimal': ['error', {
  decimalType: 'Money',
  fieldPatterns: ['amount', 'price', 'discount', 'vat'],
}]
```

## When not to use it

If your project does not have a dedicated Decimal money type, or represents money as integer minor
units (cents) typed `number` on purpose, this rule does not fit.
