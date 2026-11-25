---
'@noctcore/eslint-utils': minor
---

New `pathContainment` helpers, shared by the rules that accept a checked path: `isContainedBefore` tells whether a containment test decides that a sink runs (an `if` that exits when the path is outside, or an `if`, `?:`, `&&` or `||` around the sink, read through `!` and `const` booleans, in the function that holds the sink), with `isGuardedBefore`, `isGuardedByLogicalBefore`, `isAssertedBefore`, `containmentGuard`, `failsOutside` and `holdsInside` as its parts. The tests are `startsWith` against a base that ends in a separator, a `path.relative` result refused when it climbs and when it is absolute, and a configured guard call; a base every path is under (`'/'`, `''`, `'.'`, `path.sep`, `process.cwd()`, `path.resolve()`) is refused (`isBroadBase`). Also exported: `PathContainmentContext`, `singleInitializer`, `isProcessCwd`, `endsInSeparator` and `isStartsWithBase`.
