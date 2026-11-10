---
'@noctcore/eslint-plugin-react': patch
---

`max-hooks-per-file` no longer counts pass-through re-exports (`export { useA } from './useA'`). The hook is counted in the module that defines it, so a file that passes hooks on no longer goes over the limit for them. The doc also shows how to cover a `hooks/` directory of plain modules with `fileSuffixes: ['.ts', '.tsx']` in a scoped block.
