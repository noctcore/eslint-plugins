---
'@noctcore/eslint-plugin-contracts': minor
---

`restrict-throw-to-taxonomy` is no longer in `recommended` and is marked as needing options. With the default `allow: ['Error']` it reported every framework exception (`throw new NotFoundException()`) and every built-in other than `Error`, so it only means something once `allow` names your error classes. Enable it by name with that list; the README's "Opt-in rules" block shows how.
