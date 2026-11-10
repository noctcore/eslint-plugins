# `noctcore-react/no-native-date-input`

> Disallow native date inputs (`type="date"` and friends): Chromium formats them in the browser UI language and ignores `lang`, so the date order can contradict the page.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`<input type="date">` looks correct in every way a reviewer can check: it is the semantic element,
it is keyboard accessible, it validates, and it renders perfectly for anyone whose browser is
installed in the product's language. Chromium takes a date input's display format from the
**browser's UI language** and ignores both the element's `lang` and the page locale. A product
served with `<html lang="pl">` still shows `03/04/2026` in a Chrome installed in English, and
3 April cannot be told from 4 March. For a deadline, an expiry or a contract date, that ambiguity is
a defect, not a cosmetic one. `datetime-local`, `month` and `week` render in the browser's language
for the same reason.

The fix is a date picker that formats in the product's locale, usually a design-system component.

```tsx bad
// renders in the browser's language, whatever the page says
const DueDate = ({ field }) => <Input type="date" {...field} />;
```

```tsx good
// the picker formats in the product's locale
const DueDate = ({ field }) => <DateField {...field} />;
```

### Severity

Left out of `recommended`. Whether a native picker is acceptable is a product decision: a tool used
only by people whose browser language matches the page is fine with it. Enable the rule when the
convention is "use our picker".

## What it flags

A JSX element named in `elementNames` (default `input` and `Input`) with a literal `type` in
`types` (default `date`, `datetime-local`, `month`, `week`), braced or not. The report sits on the
`type` attribute, and its message names `replacement`.

```tsx bad reports=2
// both render the browser's own picker
const Period = () => (
  <>
    <input type="month" />
    <Input type={'datetime-local'} />
  </>
);
```

```tsx good
// the locale-aware picker for both
const Period = () => (
  <>
    <MonthField />
    <DateTimeField />
  </>
);
```

## What it does not flag

- A `type` passed as a variable (`<input type={type} />`). A wrapper that forwards its `type` is out
  of reach by design; branch on the date case before the input is rendered.
- A component not in `elementNames` that takes a `type` prop (`<InvoiceTextField type="date" />`):
  that component decides what to render.
- A member-expression element such as `<Form.Input type="date" />`.
- Files matched by `allowIn`, such as the picker component, which may render a hidden native input.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `elementNames` | `string[]` | `["input", "Input"]` | JSX element names that render a native `<input>`. |
| `types` | `string[]` | `["date", "datetime-local", "month", "week"]` | `type` values to report. |
| `replacement` | `string` | `"the design system's date picker"` | What the message tells people to use instead. |
| `allowIn` | `string[]` (globs) | `[]` | File-path globs where a native date input is allowed. |

```js
'noctcore-react/no-native-date-input': ['error', {
  elementNames: ['input', 'Input', 'TextInput'],
  replacement: '`DateField` from `@/shared/components/DateField`',
  allowIn: ['**/DateField/**'],
}]
```

## When not to use it

When the product's users all browse in the product's language, or the app is not localised, the
native picker is fine and the rule only adds friction.
