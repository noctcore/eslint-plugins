# `noctcore-architecture/single-semantic-module`

> Each module exports one semantic concern: types, constants, functions, classes, React components,
> hooks, schemas or enums. **Ships `off` in `recommended`**: choose the files and the allowed mixes
> for your codebase, then enable it.

Ported from
[`@boring-stack-pkg/eslint-plugin-module-boundaries`](https://github.com/boringstack-xyz/eslint-plugins/tree/main/eslint-plugin-module-boundaries)
0.2.0 (MIT). Upstream peers ESLint `8.57.0 || ^9.0.0`; this port runs on ESLint 9 and 10.

## Why

A file that exports a component, the hook it uses, the constant that configures it and the type of its
props has four reasons to change and four kinds of consumer. Splitting by concern keeps imports
honest: a type-only consumer never pulls in runtime code, and a constant never drags a component into
a server bundle.

The rule classifies by **AST shape**, never by filename or suffix:

| Category | Shape |
| --- | --- |
| `type` | `interface`, `type`, `namespace`, `declare ...` |
| `enum` | `enum` (or `type`, with `enumCategory: 'type'`) |
| `constant` | any other top-level value |
| `function` | function declaration or function-valued `const` |
| `class` | class declaration or class expression |
| `react-component` | PascalCase function returning JSX (or typed `FC` / `JSX.Element`) |
| `hook` | a function named like a hook (`^use[A-Z0-9]`) |
| `schema` | a call on an identifier imported from `zod`, `yup` or `valibot` |

## Examples

```ts bad
// a type and a runtime constant
export interface User {
  id: string;
}
export const DEFAULT_USER: User = { id: 'anonymous' };
```

```tsx bad
// a component and a hook
export function UserCard() {
  return <div />;
}
export function useUserCard() {
  return useQuery(userCardQuery);
}
```

```ts good
// one concern: types only
export interface User {
  id: string;
}
export type UserId = User['id'];
```

### Private helpers do not count

Only the **exported** surface defines a module (`ignorePrivateDeclarations`, default `true`). A
non-exported render helper beside a component, or a filter constant inside a hook file, serves that
surface and is not a second concern:

```tsx good
// the helper is private
function renderBadge(count: number) {
  return <span className="badge">{count}</span>;
}
export function Inbox({ unread }: { unread: number }) {
  return <div>{renderBadge(unread)}</div>;
}
```

```ts good
// the filter object is private
const ACTIVE_FILTER = { status: 'active', archived: false } as const;
export function useActiveProjects() {
  return useQuery({ queryKey: ['projects', ACTIVE_FILTER] });
}
```

A declaration exported further down by name (`export { DEFAULT_USER }`, `export default UserCard`)
is surface all the same.

## Options

```ts prose reason="the options type, not a lint example"
type SemanticCategory =
  | 'type' | 'constant' | 'function' | 'class'
  | 'react-component' | 'hook' | 'schema' | 'enum';

type Options = {
  /** Category sets a module may mix. Default []. */
  allow?: SemanticCategory[][];
  /** Whether an enum is its own category or a type. Default 'enum'. */
  enumCategory?: 'enum' | 'type';
  /** List every classified declaration and the reason in the report. Default false. */
  debug?: boolean;
  /** Skip `declare ...` and `declare global` entirely. Default false. */
  ignoreAmbientDeclarations?: boolean;
  /** Classify exported declarations only. Default true. */
  ignorePrivateDeclarations?: boolean;
  /** Libraries whose builders count as `schema`. Default ['zod', 'yup', 'valibot']. */
  schemaLibraries?: Array<'zod' | 'yup' | 'valibot'>;
  /** Default { enabled: true }. */
  reactComponentDetection?: { enabled?: boolean };
  /** Default { enabled: true, namePattern: '^use[A-Z0-9].*' }. */
  hookDetection?: { enabled?: boolean; namePattern?: string };
};
```

### `allow`: a NestJS `.constants.ts`

In a NestJS module, `<name>.constants.ts` holds one module's enums, unions and DI tokens. That mixes
categories **by design**, so allow the mix for those files only:

```js
// eslint.config.js
export default [
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { 'noctcore-architecture/single-semantic-module': 'error' },
  },
  {
    files: ['apps/api/src/**/*.constants.ts'],
    rules: {
      'noctcore-architecture/single-semantic-module': [
        'error',
        { allow: [['constant', 'type', 'enum']] },
      ],
    },
  },
];
```

```ts good filename=apps/api/src/billing/billing.constants.ts options={"allow":[["constant","type","enum"]]}
// billing.constants.ts with the config above
export const BILLING_QUEUE = Symbol('BILLING_QUEUE');
export const INVOICE_STATUSES = ['draft', 'sent', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export enum BillingEvent {
  Paid = 'billing.paid',
}
```

```ts bad filename=apps/api/src/billing/billing.constants.ts options={"allow":[["constant","type","enum"]]}
// still reported: a function is outside the allowed group
export const INVOICE_STATUSES = ['draft', 'sent', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export function isPaid(status: InvoiceStatus) {
  return status === 'paid';
}
```

An `allow` group must cover **every** detected category; a module whose categories fit inside any one
group passes.

### `enumCategory`

```js
{ enumCategory: 'type' } // `export enum Role {}` beside `export type User = {}` is one concern
```

### `ignorePrivateDeclarations: false`

Restores upstream's original behaviour, where every top-level declaration counts. Expect it to fight
every non-trivial file.

### `debug`

Adds each classified declaration and the reason to the report, which is the quickest way to see why a
file was flagged:

```
- type: User (TypeScript type-space declaration)
- constant: DEFAULT_USER (object literal runtime value)
```

## When not to use it

Barrels and generated files. Re-exports (`export * from`, `export { x } from`) are never classified, so
a pure barrel passes anyway, but generated clients routinely mix every category; scope the rule away
from them with `files` / `ignores`.
