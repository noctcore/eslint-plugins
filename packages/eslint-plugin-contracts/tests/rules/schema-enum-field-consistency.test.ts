import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { schemaEnumFieldConsistencyRule } from '../../src/rules/schema-enum-field-consistency';

const FILE = 'packages/shared/src/schemas/orders.ts';

/*
 * A synthetic shared contract module with `orderItemOutput.fulfilmentChannel`
 * declared as `z.string().nullable()` while both item inputs use
 * `fulfilmentChannelSchema`. Kept as a .txt so neither tsc nor lint treats it
 * as source. It is the case the rule exists for: one report, on the output
 * schema, and nothing else in a module full of repeated field names.
 */
const WIDENED_ORDERS = readFileSync(
  fileURLToPath(new URL('../fixtures/order-schemas-widened-fulfilment-channel.ts.txt', import.meta.url)),
  'utf8',
);

ruleTester.run('schema-enum-field-consistency', schemaEnumFieldConsistencyRule, {
  valid: [
    {
      // The fix: the output reuses the inputs' enum.
      code: `
        const categorySchema = z.enum(['A', 'B']);
        const output = z.object({ category: categorySchema.nullable() });
        const input = z.object({ category: categorySchema.optional() });
      `,
      filename: FILE,
    },
    {
      // A string/null union is not a plain z.string() (the upstream exemption).
      code: `
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
        const b = z.object({ status: z.union([z.string(), z.null()]) });
      `,
      filename: FILE,
    },
    {
      // A string that is transformed or piped outputs something else.
      code: `
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
        const b = z.object({ status: z.string().transform((v) => v.length) });
        const c = z.object({ status: z.string().pipe(z.enum(['OPEN', 'CLOSED'])) });
      `,
      filename: FILE,
    },
    {
      // An IMPORTED identifier is not assumed to be an enum: emailSchema is a
      // string schema, so two email fields must not collide.
      code: `
        import { emailSchema } from './common';
        const a = z.object({ email: emailSchema });
        const b = z.object({ email: z.string().trim() });
      `,
      filename: FILE,
    },
    {
      // A same-file identifier bound to a string schema is not an enum either.
      code: `
        const nameSchema = z.string().min(1);
        const a = z.object({ name: nameSchema });
        const b = z.object({ name: z.string() });
      `,
      filename: FILE,
    },
    {
      // A single literal is a constant, not an enum.
      code: `
        const a = z.object({ kind: z.literal('A') });
        const b = z.object({ kind: z.string() });
      `,
      filename: FILE,
    },
    {
      // ignoreFields: a key that genuinely means different things.
      code: `
        const a = z.object({ type: z.enum(['A', 'B']) });
        const b = z.object({ type: z.string() });
      `,
      filename: FILE,
      options: [{ ignoreFields: ['type'] }],
    },
    {
      // A namespace other than the configured one is not zod.
      code: `
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
        const b = z.object({ status: v.string() });
      `,
      filename: FILE,
    },
    {
      // The fixed module (the output reuses the enum) is clean end to end.
      code: WIDENED_ORDERS.replace(
        'fulfilmentChannel: z.string().nullable()',
        'fulfilmentChannel: fulfilmentChannelSchema.nullable()',
      ),
      filename: FILE,
    },
    {
      // Scope is one module: an enum in another file says nothing here.
      code: `
        import { statusSchema } from './common';
        const b = z.object({ status: z.string() });
      `,
      filename: FILE,
    },
    {
      // enumIdentifierPattern only opts in imports whose name matches.
      code: `
        import { statusLabelSchema } from './common';
        const a = z.object({ status: statusLabelSchema });
        const b = z.object({ status: z.string() });
      `,
      filename: FILE,
      options: [{ enumIdentifierPattern: 'StatusSchema$|^statusSchema$' }],
    },
    {
      // A renamed zod namespace is not zod until it is configured.
      code: `
        const a = zod.object({ status: zod.enum(['OPEN', 'CLOSED']) });
        const b = zod.object({ status: zod.string() });
      `,
      filename: FILE,
    },
    {
      // A computed key has no static name to compare.
      code: `
        const key = 'status';
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
        const b = z.object({ [key]: z.string() });
      `,
      filename: FILE,
    },
  ],
  invalid: [
    {
      // The widened workerCategory shape, reduced.
      code: `
        const categorySchema = z.enum(['A', 'B']);
        const output = z.object({ category: z.string().nullable() });
        const input = z.object({ category: categorySchema.optional() });
      `,
      filename: FILE,
      errors: [
        {
          messageId: 'widenedEnumField',
          line: 3,
          data: { field: 'category', line: '4', suggestion: '`categorySchema`' },
        },
      ],
    },
    {
      // A whole widened module: exactly one report, on orderItemOutput.
      code: WIDENED_ORDERS,
      filename: FILE,
      errors: [
        {
          messageId: 'widenedEnumField',
          line: 134,
          data: { field: 'fulfilmentChannel', line: '96', suggestion: '`fulfilmentChannelSchema`' },
        },
      ],
    },
    {
      // Inline z.enum, and a string with a refinement chain and modifiers.
      code: `
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']).default('OPEN') });
        const b = z.object({ status: z.string().trim().min(1).max(20).optional() });
      `,
      filename: FILE,
      errors: [
        {
          messageId: 'widenedEnumField',
          line: 3,
          data: { field: 'status', line: '2', suggestion: 'the same enum schema' },
        },
      ],
    },
    {
      // A union of literals only is an enum.
      code: `
        const a = z.object({ mode: z.union([z.literal('light'), z.literal('dark')]) });
        const b = z.object({ mode: z.string() });
      `,
      filename: FILE,
      errors: [{ messageId: 'widenedEnumField', line: 3 }],
    },
    {
      // zod 4's multi-value literal, and z.nativeEnum.
      code: `
        const a = z.object({ mode: z.literal(['light', 'dark']) });
        const b = z.object({ role: z.nativeEnum(Role).nullish() });
        const c = z.object({ mode: z.string(), role: z.string().describe('role') });
      `,
      filename: FILE,
      errors: [
        { messageId: 'widenedEnumField', line: 4, column: 30 },
        { messageId: 'widenedEnumField', line: 4, column: 48 },
      ],
    },
    {
      // Every modifier unwraps, and an identifier chained through another
      // identifier and through extract() still resolves to the enum.
      code: `
        const baseSchema = z.enum(['A', 'B', 'C']);
        const narrowSchema = baseSchema.extract(['A', 'B']);
        const a = z.object({ kind: narrowSchema.optional().nullable().describe('k') });
        const b = z.object({ kind: z.string() });
      `,
      filename: FILE,
      errors: [
        {
          messageId: 'widenedEnumField',
          line: 5,
          data: { field: 'kind', line: '4', suggestion: '`narrowSchema`' },
        },
      ],
    },
    {
      // .extend() shapes, and the string side reported in both directions of
      // declaration order.
      code: `
        const b = z.object({ state: z.string() });
        const a = z.object({ id: z.string() }).extend({ state: z.enum(['X', 'Y']) });
        const c = b.extend({ state: z.string().nullable() });
      `,
      filename: FILE,
      errors: [
        { messageId: 'widenedEnumField', line: 2 },
        { messageId: 'widenedEnumField', line: 4 },
      ],
    },
    {
      // Quoted keys and strictObject.
      code: `
        const a = z.strictObject({ 'status': z.enum(['OPEN', 'CLOSED']) });
        const b = z.looseObject({ status: z.string() });
      `,
      filename: FILE,
      errors: [{ messageId: 'widenedEnumField', line: 3 }],
    },
    {
      // enumIdentifierPattern opts matching imports in.
      code: `
        import { statusSchema } from './common';
        const a = z.object({ status: statusSchema });
        const b = z.object({ status: z.string() });
      `,
      filename: FILE,
      options: [{ enumIdentifierPattern: 'StatusSchema$|^statusSchema$' }],
      errors: [{ messageId: 'widenedEnumField', line: 4 }],
    },
    {
      // zodIdentifiers: a module that imports zod under another name.
      code: `
        const a = zod.object({ status: zod.enum(['OPEN', 'CLOSED']) });
        const b = zod.object({ status: zod.string() });
      `,
      filename: FILE,
      options: [{ zodIdentifiers: ['zod'] }],
      errors: [{ messageId: 'widenedEnumField', line: 3 }],
    },
    {
      // ignoreFields exempts only the listed keys.
      code: `
        const a = z.object({ type: z.enum(['A', 'B']), status: z.enum(['OPEN', 'CLOSED']) });
        const b = z.object({ type: z.string(), status: z.string() });
      `,
      filename: FILE,
      options: [{ ignoreFields: ['type'] }],
      errors: [
        {
          messageId: 'widenedEnumField',
          line: 3,
          data: { field: 'status', line: '2', suggestion: 'the same enum schema' },
        },
      ],
    },
    {
      // zodIdentifiers is a list: every configured namespace counts.
      code: `
        const a = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
        const b = zod.object({ status: zod.string() });
      `,
      filename: FILE,
      options: [{ zodIdentifiers: ['z', 'zod'] }],
      errors: [{ messageId: 'widenedEnumField', line: 3 }],
    },
  ],
});
