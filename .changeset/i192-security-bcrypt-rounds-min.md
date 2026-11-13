---
'@noctcore/eslint-plugin-security': minor
---

Add the opt-in `bcrypt-rounds-min` rule. It reports a numeric literal cost below `minRounds` passed to bcrypt: the second argument of `hash` / `hashSync` and the first of `genSalt` / `genSaltSync`. The call must be bound to `bcrypt` or `bcryptjs` through a default, namespace or named import (aliased or not), `const bcrypt = require('bcrypt')` or `const { hash } = require('bcrypt')`; a shadowing local, an unbound global and a cost that is not a numeric literal (an env value, a salt string) are left alone. `minRounds` defaults to 10, and only a cost strictly below it is reported. `bcryptModules` defaults to `['bcrypt', 'bcryptjs']`, and a configured list replaces the default rather than adding to it, so `['@node-rs/bcrypt']` tracks only that module.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. Enable it with `'noctcore-security/bcrypt-rounds-min': 'error'`, or with your own minimum.
