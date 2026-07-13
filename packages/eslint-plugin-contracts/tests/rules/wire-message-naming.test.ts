import { ruleTester } from '@noctcore/eslint-test-utils';

import { wireMessageNamingRule } from '../../src/rules/wire-message-naming';

const FILE = 'src/contracts/messages.ts';

ruleTester.run('wire-message-naming', wireMessageNamingRule, {
  valid: [
    // Event discriminant matches kebab(const minus suffix).
    {
      code: `import { z } from 'zod';\nexport const TaskCompletedEvent = z.object({ type: z.literal('task-completed'), id: z.string() });`,
      filename: FILE,
    },
    // Command discriminant, chained builder.
    {
      code: `import { z } from 'zod';\nexport const RunTaskCommand = z.object({ type: z.literal('run-task') }).strict();`,
      filename: FILE,
    },
    // Non-message const is ignored (no role suffix).
    {
      code: `import { z } from 'zod';\nexport const TaskSchema = z.object({ type: z.literal('whatever') });`,
      filename: FILE,
    },
    // Role-suffixed const without a type literal is ignored.
    {
      code: `import { z } from 'zod';\nexport const TaskCompletedEvent = z.object({ id: z.string() });`,
      filename: FILE,
    },
    // Custom roleSuffixes: `Event` is no longer a role suffix, so this is ignored.
    {
      code: `import { z } from 'zod';\nexport const TaskCompletedEvent = z.object({ type: z.literal('whatever') });`,
      filename: FILE,
      options: [{ roleSuffixes: ['Message'] }],
    },
  ],
  invalid: [
    // camelCase discriminant — must be kebab.
    {
      code: `import { z } from 'zod';\nexport const TaskCompletedEvent = z.object({ type: z.literal('taskCompleted') });`,
      filename: FILE,
      errors: [{ messageId: 'typeMismatch' }],
      output: `import { z } from 'zod';\nexport const TaskCompletedEvent = z.object({ type: z.literal('task-completed') });`,
    },
    // Wrong value entirely.
    {
      code: `import { z } from 'zod';\nexport const RunTaskCommand = z.object({ type: z.literal('run') });`,
      filename: FILE,
      errors: [{ messageId: 'typeMismatch' }],
      output: `import { z } from 'zod';\nexport const RunTaskCommand = z.object({ type: z.literal('run-task') });`,
    },
    // Custom roleSuffixes: a `Message`-suffixed const is now policed and autofixed.
    {
      code: `import { z } from 'zod';\nexport const TaskDoneMessage = z.object({ type: z.literal('done') });`,
      filename: FILE,
      options: [{ roleSuffixes: ['Message'] }],
      errors: [{ messageId: 'typeMismatch' }],
      output: `import { z } from 'zod';\nexport const TaskDoneMessage = z.object({ type: z.literal('task-done') });`,
    },
  ],
});
