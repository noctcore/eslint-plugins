import { ruleTester } from '@noctcore/eslint-test-utils';

import { passwordInputRequiresAutocompleteRule } from '../../src/rules/password-input-requires-autocomplete';

const FILE = 'src/settings/PasswordSection.tsx';

ruleTester.run('password-input-requires-autocomplete', passwordInputRequiresAutocompleteRule, {
  valid: [
    {
      code: 'const C = () => <Input type="password" autoComplete="current-password" {...field} />;',
      filename: FILE,
    },
    // The lowercase HTML spelling counts too.
    { code: 'const C = () => <input type="password" autocomplete="new-password" />;', filename: FILE },
    // An expression is an explicit choice; `jsx-a11y/autocomplete-valid` checks the value.
    {
      code: 'const C = ({ purpose }) => <Input type="password" autoComplete={purpose} />;',
      filename: FILE,
    },
    // Any other type is out of scope, and no type at all is a text input.
    { code: 'const C = () => <Input type="email" {...field} />;', filename: FILE },
    { code: 'const C = () => <Input {...field} />;', filename: FILE },
    // A toggle between two non-password types.
    { code: 'const C = ({ on }) => <Input type={on ? "text" : "email"} />;', filename: FILE },
    // A `let` can be reassigned anywhere, so it is not followed.
    { code: 'let t = "password"; const C = () => <Input type={t} />;', filename: FILE },
    // A prop whose value is unknown here is not assumed to be a password.
    { code: 'const C = ({ type }) => <Input type={type} />;', filename: FILE },
    // A field named password with a text type is not a password field.
    { code: 'const C = () => <Input name="password" type="text" />;', filename: FILE },
  ],
  invalid: [
    // Present but naming no purpose: nothing a password manager can use.
    {
      code: [
        'const C = () => <>',
        '  <Input type="password" autoComplete={undefined} />',
        '  <Input type="password" autoComplete />',
        '  <Input type="password" autoComplete="" />',
        '  <Input type="password" autoComplete={null} />',
        '</>;',
      ].join('\n'),
      filename: FILE,
      errors: [
        { messageId: 'missingAutocomplete', line: 2 },
        { messageId: 'missingAutocomplete', line: 3 },
        { messageId: 'missingAutocomplete', line: 4 },
        { messageId: 'missingAutocomplete', line: 5 },
      ],
    },
    // The shape a settings form shipped with: the spread is react-hook-form's
    // `field`, which never carries autoComplete. The report sits on `type`.
    {
      code: 'const C = () => <Input type="password" placeholder={p} {...field} />;',
      filename: FILE,
      errors: [{ messageId: 'missingAutocomplete', line: 1, column: 24, endColumn: 39 }],
    },
    { code: 'const C = () => <input type="password" />;', filename: FILE, errors: [{ messageId: 'missingAutocomplete' }] },
    // Braced literal, template literal and a cast, same string.
    {
      code: 'const C = () => <><Input type={"password"} /><Input type={`password`} /><Input type={"password" as const} /></>;',
      filename: FILE,
      errors: [
        { messageId: 'missingAutocomplete' },
        { messageId: 'missingAutocomplete' },
        { messageId: 'missingAutocomplete' },
      ],
    },
    // A wrapper forwarding the type is a password field too.
    {
      code: 'const C = () => <AuthField name="password" type="password" label={l} />;',
      filename: FILE,
      errors: [{ messageId: 'missingAutocomplete' }],
    },
    // The show/hide toggle, inline and through a const.
    {
      code: 'const C = ({ shown }) => <Input type={shown ? "text" : "password"} />;',
      filename: FILE,
      errors: [{ messageId: 'missingAutocomplete' }],
    },
    {
      code: [
        'const C = ({ shown }) => {',
        '  const passwordInputType = shown ? "text" : "password";',
        '  return <Input type={passwordInputType} {...field} />;',
        '};',
      ].join('\n'),
      filename: FILE,
      errors: [{ messageId: 'missingAutocomplete', line: 3 }],
    },
  ],
});
