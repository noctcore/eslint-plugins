---
'@noctcore/eslint-plugin-architecture': patch
---

`single-semantic-module` keeps the original `SyntaxError` as the `cause` when it rejects an invalid `hookDetection.namePattern`, so the stack of the bad pattern is no longer lost. Found by linting this repository with its own rules.
