# `noctcore-react/password-input-requires-autocomplete`

> A password field must carry an explicit `autoComplete` purpose, so a password manager can fill the current password and save a new one.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A password field with no `autoComplete` renders, validates and submits exactly like one that has
it, so nothing on the developer's screen says it is wrong. What breaks is the password manager: it
cannot tell a sign-in field from a new-password field, so it neither fills the current password nor
offers to save the new one. Users fall back to typing, or to weaker passwords they can remember.
WCAG 1.3.5 (identify input purpose) and 3.3.8 (accessible authentication) ask for the purpose to be
declared.

`jsx-a11y/autocomplete-valid` checks a value that is present. Nothing checks that one is there at
all, and the commonest real shape, a form library spreading its field object, hides the gap:

```tsx bad
// the spread is react-hook-form's `field`, which never carries autoComplete
const PasswordField = ({ field }) => <Input type="password" placeholder="Password" {...field} />;
```

```tsx good
// the purpose is written down, so the manager knows to fill the current password
const PasswordField = ({ field }) => (
  <Input type="password" placeholder="Password" autoComplete="current-password" {...field} />
);
```

## What it flags

Any JSX element, intrinsic or component, whose `type` can be the string `"password"` and that has
no `autoComplete` (or `autocomplete`) naming a purpose. The report sits on the `type` attribute.
`type` counts as a password when it is:

- a literal, braced or not: `type="password"`, `type={"password"}`, ``type={`password`}``;
- either branch of a conditional, the show/hide toggle: `type={shown ? 'text' : 'password'}`;
- a `const` in scope initialised to one of those.

A wrapper component that takes `type="password"` forwards it to an input, so it is checked too.

An `autoComplete` that is written but names no purpose is reported like a missing one: the bare
attribute (which JSX reads as `true`), an empty string, `{undefined}` and `{null}`.

```tsx bad
// a show/hide toggle through a const, with an empty purpose
function NewPassword({ shown }) {
  const inputType = shown ? 'text' : 'password';
  return <Input type={inputType} autoComplete="" />;
}
```

```tsx good
// the toggle keeps the purpose in both states
function NewPassword({ shown }) {
  const inputType = shown ? 'text' : 'password';
  return <Input type={inputType} autoComplete="new-password" />;
}
```

## What it does not flag

- An explicit `autoComplete` of any value, including an expression (`autoComplete={purpose}`) and
  `"off"`. Which value is right is `jsx-a11y/autocomplete-valid`'s job.
- A `type` that cannot be `"password"`: another literal, a prop forwarded from the caller
  (`type={type}`), or a `let` binding.
- A field named `password` with a text type: the attribute that matters is `type`.

An API token or secret key typed into a masked field is not a password the user owns. Declare that
with `autoComplete="off"` so the manager does not offer to save it:

```tsx good
// a masked API token, not an account password
const TokenField = ({ token, onChange }) => (
  <Input type="password" autoComplete="off" value={token} onChange={onChange} />
);
```

## When not to use it

In an app with no password fields, the rule never fires, so it costs nothing to leave on. Turn it
off only if the forms are rendered by a library that sets `autoComplete` itself from a prop the rule
cannot see.

## Related

- [`props-must-be-visual`](./props-must-be-visual.md) allows a live `password` prop on purpose;
  this rule is about the input that receives it.
