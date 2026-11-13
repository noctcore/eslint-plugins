# `noctcore-security/bcrypt-rounds-min`

> A bcrypt `hash` / `hashSync` / `genSalt` / `genSaltSync` call must not pass a literal cost below `minRounds` (default 10).

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

bcrypt's cost is a power of two: every step down halves the work an attacker needs to try a guess
against a leaked hash. A cost of 8 is four times cheaper to crack than the library default of 10,
and a cost of 4 is close to free.

```ts bad
import bcrypt from 'bcrypt';

// a cost picked to keep tests fast, shipped to production
export const hashPassword = (password: string) => bcrypt.hash(password, 8);
```

```ts good
import bcrypt from 'bcrypt';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
```

## What it flags

A numeric literal cost below `minRounds` in the cost argument of four bcrypt functions:

| Function      | Cost argument |
| ------------- | ------------- |
| `hash`        | second        |
| `hashSync`    | second        |
| `genSalt`     | first         |
| `genSaltSync` | first         |

The call must be bound to a module in `bcryptModules` (`bcrypt` and `bcryptjs` by default). The rule
follows a default import, a namespace import, a named import under any alias,
`const bcrypt = require('bcrypt')` and `const { hash } = require('bcrypt')`. It resolves the name
through scope at the call, so a parameter or local that shadows the import is not mistaken for it.

```ts bad
import { hashSync as hashPasswordSync } from 'bcryptjs';

export const seedHash = hashPasswordSync('admin', 4);
```

```ts bad
const { genSalt } = require('bcrypt');

export const salt = genSalt(6);
```

## What it does not flag

A cost that is not a numeric literal is accepted on trust, because its value is only known at
runtime. Reading the cost from configuration is the usual fix:

```ts good
import { hash } from 'bcrypt';

export const hashPassword = (password: string) => hash(password, Number(process.env.BCRYPT_ROUNDS));
```

A precomputed salt string in the cost position carries its own cost and is not read:

```ts good
import bcrypt from 'bcrypt';

export const hashPassword = (password: string, salt: string) => bcrypt.hash(password, salt);
```

A `hash` that is not bound to a tracked module is a different function:

```ts good
import { hash } from './digest';

export const checksum = (data: string) => hash(data, 4);
```

The rule also does not follow a cost stored in a `const`, a dynamic `import('bcrypt')`,
`import bcrypt = require('bcrypt')`, computed access such as `bcrypt['hash']`, or a binding that is
reassigned. Those shapes are rare in password code and are left to review.

## Options

| Option          | Type       | Default                  | Description                                                                                |
| --------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `minRounds`     | `number`   | `10`                     | The lowest cost accepted. A literal cost strictly below it is reported.                    |
| `bcryptModules` | `string[]` | `['bcrypt', 'bcryptjs']` | Module names whose bcrypt functions are tracked. A configured list replaces the default.   |

```js
// eslint.config.js
export default [
  {
    rules: {
      'noctcore-security/bcrypt-rounds-min': ['error', { minRounds: 12, bcryptModules: ['bcrypt', '@node-rs/bcrypt'] }],
    },
  },
];
```

With `minRounds` raised to 14, a cost of 12 is reported:

```ts bad options={"minRounds":14}
import bcrypt from 'bcrypt';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
```

```ts good options={"minRounds":14}
import bcrypt from 'bcrypt';

export const hashPassword = (password: string) => bcrypt.hash(password, 14);
```

A configured `bcryptModules` tracks the modules it names, and only those:

```ts bad options={"bcryptModules":["@node-rs/bcrypt"]}
import { hash } from '@node-rs/bcrypt';

export const hashPassword = (password: string) => hash(password, 4);
```

```ts good options={"bcryptModules":["@node-rs/bcrypt"]}
import { hash } from '@node-rs/bcrypt';

export const hashPassword = (password: string) => hash(password, 12);
```

## When not to use it

The rule is opt-in only because the package is at 1.x, where a rule entering `recommended` is a
breaking change. It needs no options to be useful. The default of 10 matches the default cost of
`bcrypt` and `bcryptjs`, so it flags only code that lowers the cost below what the library would pick
on its own. Raise `minRounds` to match your own policy.

Leave it off for code that hashes with a deliberately low cost outside production, such as test
fixtures, by scoping it with `files` / `ignores` in your config.
