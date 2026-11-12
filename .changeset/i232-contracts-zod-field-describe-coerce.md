---
'@noctcore/eslint-plugin-contracts': patch
---

Fix two gaps in `zod-field-describe`: a field built from a member chain on the zod namespace (`z.coerce.string().min(1)`, `z.iso.date()`) was skipped and now needs a description, and a description inside the first argument of `z.optional(...)` or `z.nullable(...)` is now found instead of reported as missing. The rule is in no preset, so a project spreading `recommended` sees no new errors; a project that enabled it may see new reports on undescribed `z.coerce` fields.
