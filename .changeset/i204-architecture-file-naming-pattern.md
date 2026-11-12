---
'@noctcore/eslint-plugin-architecture': minor
---

Add the opt-in `file-naming-pattern` rule. In folders matched by `folders`, a file's basename must match `pattern`, a regular expression in which every `{folder}` stands for the file's immediate parent folder name (escaped), so `account/account.routes.ts` passes `^{folder}(\.[a-z-]+)?\.ts$` and `account/routes.ts` is reported with the expected pattern in the message. Files whose parent folder does not match, and files matched by `allowIn`, are never reported, and an invalid `pattern` is reported as a configuration problem instead of throwing. The rule does nothing until `folders` and `pattern` are set and is in neither preset, so a project spreading `recommended` or `strict` sees no new errors.
