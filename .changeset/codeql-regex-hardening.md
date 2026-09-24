---
'@noctcore/lint-meta-rules': patch
---

`ui-primitive-shape` now treats its `extension` and `barrelFile` options as literal text instead of regex source, so an extension like `.c++` no longer throws and `index.ts` no longer matches `indexxts`. `prisma-method-surface`, `tenant-model-registry-parity` and `eslint-config-no-warn` strip comments and trailing slashes in linear time, so a generated client with an unclosed `/*` can no longer stall the scan.
