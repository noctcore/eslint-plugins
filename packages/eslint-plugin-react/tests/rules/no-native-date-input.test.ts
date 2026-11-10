import { ruleTester } from '@noctcore/eslint-test-utils';

import { noNativeDateInputRule } from '../../src/rules/no-native-date-input';

const FILE = 'src/invoices/InvoiceFormDialog.tsx';

ruleTester.run('no-native-date-input', noNativeDateInputRule, {
  valid: [
    // The replacement picker.
    { code: 'const C = () => <DateField value={v} onChange={set} />;', filename: FILE },
    // Every other input type renders the same in every locale.
    { code: 'const C = () => <Input type="text" />;', filename: FILE },
    { code: 'const C = () => <Input type="email" maxLength={200} />;', filename: FILE },
    // A field-router prop is not a native input: the component decides what to render.
    { code: 'const C = () => <InvoiceTextField name="birthDate" type="date" />;', filename: FILE },
    // A forwarded variable is out of reach by design.
    { code: 'const C = ({ type }) => <input type={type} />;', filename: FILE },
    // A member-expression element is not matched by name.
    { code: 'const C = () => <Form.Input type="date" />;', filename: FILE },
    // The picker's own file, exempted with allowIn.
    {
      code: 'const C = () => <input type="date" className="sr-only" />;',
      filename: 'packages/ui/src/components/date-field.tsx',
      options: [{ allowIn: ['**/date-field.tsx'] }],
    },
    // A narrowed `types` list leaves the others alone.
    { code: 'const C = () => <input type="month" />;', filename: FILE, options: [{ types: ['date'] }] },
  ],
  invalid: [
    {
      code: 'const C = () => <Input type="date" {...field} />;',
      filename: FILE,
      errors: [
        {
          messageId: 'nativeDateInput',
          data: { type: 'date', replacement: "the design system's date picker" },
          line: 1,
          column: 24,
        },
      ],
    },
    // The lowercase intrinsic, and a braced literal.
    { code: 'const C = () => <input type="date" />;', filename: FILE, errors: [{ messageId: 'nativeDateInput' }] },
    { code: 'const C = () => <Input type={"date"} />;', filename: FILE, errors: [{ messageId: 'nativeDateInput' }] },
    // `datetime-local`, `month` and `week` render in the browser language too.
    {
      code: 'const C = () => <><Input type="datetime-local" /><input type="month" /><input type="week" /></>;',
      filename: FILE,
      errors: [
        { messageId: 'nativeDateInput', data: { type: 'datetime-local', replacement: "the design system's date picker" } },
        { messageId: 'nativeDateInput', data: { type: 'month', replacement: "the design system's date picker" } },
        { messageId: 'nativeDateInput', data: { type: 'week', replacement: "the design system's date picker" } },
      ],
    },
    // A custom replacement and element list.
    {
      code: 'const C = () => <TextInput type="date" />;',
      filename: FILE,
      options: [{ elementNames: ['TextInput'], replacement: '`DateField` from `@/shared/DateField`' }],
      errors: [
        {
          messageId: 'nativeDateInput',
          data: { type: 'date', replacement: '`DateField` from `@/shared/DateField`' },
        },
      ],
    },
    // allowIn only exempts the files it matches.
    {
      code: 'const C = () => <input type="date" />;',
      filename: FILE,
      options: [{ allowIn: ['**/date-field.tsx'] }],
      errors: [{ messageId: 'nativeDateInput' }],
    },
  ],
});
