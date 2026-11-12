---
'@noctcore/eslint-plugin-contracts': minor
---

Add `zod-field-describe`, an opt-in rule that reports a property of a `z.object` (or an `.extend` shape) whose schema has no `.describe('...')` and no `.meta({ description })`, so generated JSON Schema, tool definitions and API docs have text for every field. It takes `zodIdentifiers` and `allowSchemaReferences` (default `true`, which leaves a field that is another schema, such as `user: UserSchema`, to that schema's own description). The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors; enable it under a `files` glob for your schema modules.
