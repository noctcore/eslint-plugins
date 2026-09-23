---
'@noctcore/eslint-plugin-prisma': minor
---

`soft-deletable-tables-require-deleted-at` gains `allowInFunctions`, which exempts named functions in matching files instead of whole files. A call belongs to its nearest named enclosing function, looking through anonymous callbacks, so every other query in an exempt file stays policed.
