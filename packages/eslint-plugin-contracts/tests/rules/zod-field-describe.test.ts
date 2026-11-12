import { ruleTester } from '@noctcore/eslint-test-utils';

import { zodFieldDescribeRule } from '../../src/rules/zod-field-describe';

const FILE = 'packages/shared/src/schemas/user.schemas.ts';

ruleTester.run('zod-field-describe', zodFieldDescribeRule, {
  valid: [
    {
      code: `const A = z.object({ name: z.string().describe('Display name') });`,
      filename: FILE,
    },
    {
      // The description may sit anywhere in the chain.
      code: `
        const A = z.object({
          a: z.string().describe('first').min(1),
          b: z.string().min(1).max(10).describe('last'),
          c: z.number().describe('mid').optional().nullable(),
        });
      `,
      filename: FILE,
    },
    {
      code: `const A = z.object({ name: z.string().meta({ description: 'Display name' }) });`,
      filename: FILE,
    },
    {
      code: `const A = z.object({ name: z.string().meta({ description: 'x' }).min(1), 'quoted': z.string().meta({ 'description': 'y' }) });`,
      filename: FILE,
    },
    {
      // A computed description cannot be judged, so it is trusted.
      code: `
        const A = z.object({
          a: z.string().describe(DESCRIPTIONS.name),
          b: z.string().describe(\`Total for \${unit}\`),
          c: z.string().meta(metaFor('c')),
          d: z.string().meta({ ...base }),
          e: z.string().meta({ description: DESCRIPTIONS.e }),
        });
      `,
      filename: FILE,
    },
    {
      code: `const A = z.object({ name: z.string().describe(\`Display name\`) });`,
      filename: FILE,
    },
    {
      // Spreads and non-schema values are not fields to describe.
      code: `const A = z.object({ ...base, nested: someCondition ? first : second });`,
      filename: FILE,
    },
    {
      // Not a zod namespace.
      code: `const A = joi.object({ name: joi.string() });`,
      filename: FILE,
    },
    {
      // Not an object shape.
      code: `const A = z.array(z.string()); const B = z.string(); const C = z.object(shape);`,
      filename: FILE,
    },
    {
      // Schema references carry their own description by default.
      code: `
        const A = z.object({
          user: UserSchema,
          owner: Schemas.User,
          maybe: UserSchema.optional(),
          list: Schemas.User.array().nullable(),
        });
      `,
      filename: FILE,
    },
    {
      // A described reference is fine with the option off.
      code: `const A = z.object({ user: UserSchema.describe('The user') });`,
      options: [{ allowSchemaReferences: false }],
      filename: FILE,
    },
    {
      code: `const A = zod.object({ name: zod.string().describe('Display name') });`,
      options: [{ zodIdentifiers: ['zod'] }],
      filename: FILE,
    },
    {
      // `.extend` shapes are checked the same way.
      code: `const B = A.extend({ age: z.number().describe('Age in years') });`,
      filename: FILE,
    },
    {
      code: `const A = z.strictObject({ a: z.string().describe('a') }); const B = z.looseObject({ b: z.string().describe('b') });`,
      filename: FILE,
    },
  ],
  invalid: [
    {
      code: `const A = z.object({ name: z.string().min(1) });`,
      errors: [{ messageId: 'missingDescription', data: { field: 'name' } }],
      filename: FILE,
    },
    {
      code: `const A = z.object({ name: z.string() });`,
      errors: [{ messageId: 'missingDescription', data: { field: 'name' } }],
      filename: FILE,
    },
    {
      // An empty or blank description is not a description.
      code: `
        const A = z.object({
          a: z.string().describe(''),
          b: z.string().describe('   '),
          c: z.string().describe(),
          d: z.string().describe(\`\`),
        });
      `,
      errors: [
        { messageId: 'missingDescription', data: { field: 'a' } },
        { messageId: 'missingDescription', data: { field: 'b' } },
        { messageId: 'missingDescription', data: { field: 'c' } },
        { messageId: 'missingDescription', data: { field: 'd' } },
      ],
      filename: FILE,
    },
    {
      code: `
        const A = z.object({
          a: z.string().meta({}),
          b: z.string().meta({ description: '' }),
          c: z.string().meta({ title: 'Title' }),
          d: z.string().meta(),
        });
      `,
      errors: [
        { messageId: 'missingDescription', data: { field: 'a' } },
        { messageId: 'missingDescription', data: { field: 'b' } },
        { messageId: 'missingDescription', data: { field: 'c' } },
        { messageId: 'missingDescription', data: { field: 'd' } },
      ],
      filename: FILE,
    },
    {
      // Only the undescribed fields report, and a description on the object does not cover them.
      code: `
        const A = z
          .object({
            id: z.string().describe('Identifier'),
            name: z.string(),
            'display-name': z.string().optional(),
          })
          .describe('A user');
      `,
      errors: [
        { messageId: 'missingDescription', data: { field: 'name' } },
        { messageId: 'missingDescription', data: { field: 'display-name' } },
      ],
      filename: FILE,
    },
    {
      code: `const A = z.object({ [KEY]: z.string(), tags: z.array(z.string()).optional() });`,
      errors: [
        { messageId: 'missingDescription', data: { field: 'KEY' } },
        { messageId: 'missingDescription', data: { field: 'tags' } },
      ],
      filename: FILE,
    },
    {
      // A description inside a nested schema does not describe the field holding it.
      code: `const A = z.object({ inner: z.object({ a: z.string().describe('a') }) });`,
      errors: [{ messageId: 'missingDescription', data: { field: 'inner' } }],
      filename: FILE,
    },
    {
      code: `const B = A.extend({ age: z.number() }); const C = A.safeExtend({ n: z.number() });`,
      errors: [
        { messageId: 'missingDescription', data: { field: 'age' } },
        { messageId: 'missingDescription', data: { field: 'n' } },
      ],
      filename: FILE,
    },
    {
      code: `const A = z.strictObject({ a: z.string() }); const B = z.looseObject({ b: z.string() });`,
      errors: [
        { messageId: 'missingDescription', data: { field: 'a' } },
        { messageId: 'missingDescription', data: { field: 'b' } },
      ],
      filename: FILE,
    },
    {
      // With allowSchemaReferences false, an undescribed reference is reported.
      code: `
        const A = z.object({
          user: UserSchema,
          owner: Schemas.User,
          maybe: UserSchema.optional(),
        });
      `,
      options: [{ allowSchemaReferences: false }],
      errors: [
        { messageId: 'missingDescription', data: { field: 'user' } },
        { messageId: 'missingDescription', data: { field: 'owner' } },
        { messageId: 'missingDescription', data: { field: 'maybe' } },
      ],
      filename: FILE,
    },
    {
      code: `const A = zod.object({ name: zod.string() }); const B = z.object({ other: z.string() });`,
      options: [{ zodIdentifiers: ['zod'] }],
      errors: [{ messageId: 'missingDescription', data: { field: 'name' } }],
      filename: FILE,
    },
  ],
});
