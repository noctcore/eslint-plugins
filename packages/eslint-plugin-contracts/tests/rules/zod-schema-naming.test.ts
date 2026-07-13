import { ruleTester } from '@noctcore/eslint-test-utils';

import { zodSchemaNamingRule } from '../../src/rules/zod-schema-naming';

const FILE = 'src/contracts/task.ts';

// The Event/Command/Query role suffixes opt into the carve-out.
const roleOptions = [{ roleSuffixes: ['Event', 'Command', 'Query'] }] as const;

ruleTester.run('zod-schema-naming', zodSchemaNamingRule, {
  valid: [
    // Correctly named schema with its sibling inferred type.
    {
      code: `import { z } from 'zod';\nexport const TaskSchema = z.object({ id: z.string() });\nexport type Task = z.infer<typeof TaskSchema>;`,
      filename: FILE,
    },
    // Chained zod builder still resolves to root z.
    {
      code: `import { z } from 'zod';\nexport const NameSchema = z.string().min(1);\nexport type Name = z.infer<typeof NameSchema>;`,
      filename: FILE,
    },
    // Non-zod exported const is ignored.
    { code: `export const MAX = 10;`, filename: FILE },
    // With roleSuffixes opted in, role-suffixed members are carved out (their
    // naming contract is wire-message-naming's job).
    {
      code: `import { z } from 'zod';\nexport const FooCompletedEvent = z.object({ type: z.literal('foo-completed') });`,
      filename: FILE,
      options: roleOptions,
    },
    {
      code: `import { z } from 'zod';\nexport const RunTaskCommand = z.object({ type: z.literal('run-task') });`,
      filename: FILE,
      options: roleOptions,
    },
    {
      code: `import { z } from 'zod';\nexport const ListSessionsQuery = z.object({ type: z.literal('list-sessions') });`,
      filename: FILE,
      options: roleOptions,
    },
  ],
  invalid: [
    // Schema const not suffixed `Schema`.
    {
      code: `import { z } from 'zod';\nexport const Task = z.object({});`,
      filename: FILE,
      errors: [{ messageId: 'schemaNaming' }],
    },
    // A lowercase standalone schema must be `FooSchema`, not `foo`.
    {
      code: `import { z } from 'zod';\nexport const foo = z.string();`,
      filename: FILE,
      errors: [{ messageId: 'schemaNaming' }],
    },
    // Correctly named but no sibling inferred type.
    {
      code: `import { z } from 'zod';\nexport const TaskSchema = z.object({});`,
      filename: FILE,
      errors: [{ messageId: 'missingType' }],
    },
    // With the DEFAULT (empty roleSuffixes), the base `*Schema` convention
    // applies cleanly: a role-suffixed export is flagged like any other.
    {
      code: `import { z } from 'zod';\nexport const FooCompletedEvent = z.object({ type: z.literal('foo-completed') });`,
      filename: FILE,
      errors: [{ messageId: 'schemaNaming' }],
    },
  ],
});
