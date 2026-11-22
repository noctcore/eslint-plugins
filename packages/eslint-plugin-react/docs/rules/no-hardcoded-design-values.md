# `noctcore-react/no-hardcoded-design-values`

> Disallow hardcoded colours, spacing, font sizes and families, radii, shadows and motion in class strings, inline styles and CSS-in-JS, so a theme can restyle components through design tokens.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A design system lets a theme restyle every component by swapping tokens: CSS variables, and the
Tailwind theme utilities built on them. A component that writes a value directly opts out. The
theme changes and that component does not, and nobody notices until a dark mode ships with one
bright blue button, or a rebrand leaves half the radii behind. Review rarely catches it, because
`bg-blue-500` looks like perfectly normal Tailwind.

```tsx bad reports=3
export const Badge = ({ children }) => (
  <span className="rounded-[6px] bg-blue-500 text-white">{children}</span>
);
```

```tsx good
export const Badge = ({ children }) => (
  <span className="rounded-md bg-primary text-primary-foreground">{children}</span>
);
```

### Severity

Left out of `recommended`. The rule is for a design system or UI library package that themes
through tokens. An application that styles with the Tailwind palette on purpose would see a report
on most class strings. Enable it with `files` scoped to the component packages.

## What it flags

**Class strings**: the `className` and `class` attributes of JSX elements, and every string passed
to a class helper (`cn`, `clsx`, `classnames`, `cx`, `cva`, `tv`, `twMerge`, `twJoin`), including
object keys, arrays and both branches of a conditional. In them, a token is reported when it is

- a Tailwind palette utility: a colour utility (`bg`, `text`, `border`, `ring`, `fill`, `stroke`,
  `from`, `shadow`, ...) with a palette colour (`blue-500`, `zinc-900`, `black`, `white`), with or
  without variants and an opacity modifier;
- an arbitrary value that hardcodes a design value: a colour (`text-[#fafafa]`, `bg-[oklch(...)]`),
  spacing (`p-[13px]`, `-mt-[4px]`), a font size (`text-[13px]`), a font family (`font-['Inter']`),
  a radius (`rounded-[6px]`), a shadow (`shadow-[0_1px_2px_rgba(0,0,0,0.1)]`) or motion
  (`duration-[200ms]`, `ease-[cubic-bezier(...)]`). Type hints (`text-[length:15px]`) and arbitrary
  properties (`[color:#333]`) are read too;
- a `font-<name>` utility for a name in `fontNames`.

```tsx bad reports=4
const button = cva('inline-flex items-center rounded-[4px]', {
  variants: {
    intent: { primary: 'bg-blue-600 hover:bg-blue-700', danger: 'text-[#dc2626]' },
  },
});
```

```tsx good
const button = cva('inline-flex items-center rounded-sm', {
  variants: {
    intent: { primary: 'bg-primary hover:bg-primary/90', danger: 'text-destructive' },
  },
});
```

**Inline styles**: the `style` attribute's object. A property in a design category is reported
when its literal value hardcodes one: a raw colour (hex, `rgb()`, `hsl()`, `oklch()`, a named
colour), a non-zero length for spacing, font size and radius (a bare number counts, since React
adds `px`), a shadow, a font family name, or a duration or `cubic-bezier()` / `steps()` curve.

```tsx bad reports=3
const Panel = ({ children }) => (
  <div style={{ color: '#1e40af', padding: '12px 16px', borderRadius: 8 }}>{children}</div>
);
```

```tsx good
const Panel = ({ children }) => (
  <div style={{ color: 'var(--color-accent)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)' }}>
    {children}
  </div>
);
```

**CSS-in-JS**: a tagged template whose tag starts with one of `cssTags` (`styled.div`,
`styled(Button).attrs(...)`, `css`, `keyframes`). Its declarations are read like inline styles;
an interpolated part of a value (`${(p) => p.color}`) is not, and neither are `/* */` and `//`
comments (a `//` inside `url(...)` or a string is not a comment).

```tsx bad reports=2
const Card = styled.div`
  color: #333;
  transition: transform 150ms ease;
`;
```

```tsx good
const Card = styled.div`
  color: var(--color-fg);
  transition: transform var(--duration-fast) var(--ease-out);
`;
```

### Token variables

Any CSS variable counts as a token by default. Set `allowedVarPrefixes` to say which ones are:
then every `var(--x)`, Tailwind `(--x)` shorthand and v3 `[--x]` value in a class string, style or
CSS template must start with one of the prefixes or be named in `allowedVars`. The default
`allowedVars` are the runtime geometry variables Base UI sets on popups (`--transform-origin`,
`--anchor-width`, `--anchor-height`, `--available-width`, `--available-height`).

```tsx bad options={"allowedVarPrefixes":["--color-","--radius-"]}
const Field = () => <input className="bg-(--brand) rounded-(--radius-md)" />;
```

```tsx good
const Field = () => <input className="bg-(--color-brand) rounded-(--radius-md)" />;
```

## What it does not flag

- Theme-scale utilities: `bg-primary`, `text-sm`, `p-4`, `rounded-md`, `shadow-lg`,
  `duration-200`. In Tailwind v4 these come from the theme, so they are the tokens.
- Arbitrary values for geometry, which are not design values: `w-[200px]`, `top-[3px]`,
  `grid-cols-[1fr_2fr]`, `z-[60]`, `bg-[url(/hero.png)]`, `border-[1px]`, `font-[550]` (a weight).
- `0`, percentages (`borderRadius: '50%'`), the global keywords (`inherit`, `initial`, `unset`),
  `currentColor`, `transparent`, `none`, `auto`, generic font families (`monospace`,
  `system-ui`) and keyword easings (`ease-in-out`, `linear`).
- A fallback inside `var(--radius, 6px)`: only the variable is read.
- Arithmetic on a token: a `calc()`, `min()`, `max()` or `clamp()` that reads a variable
  (`rounded-[calc(var(--radius)-2px)]`, `min(var(--radius-md), 10px)`) derives its value from the
  token, so the literal offset in it is not reported. A `calc()` without a variable
  (`rounded-[calc(6px+2px)]`) still is.
- `url(...)`: an SVG fragment reference (`fill-[url(#fade)]`, `fill: 'url(#a1b2c3)'`) or a file
  name is never read as a colour.
- Unitless style values outside the categories (`opacity: 0.5`, `zIndex: 10`, `lineHeight: 1.5`),
  and properties outside the categories (`width: 200`).
- Values the rule cannot read: a variable, a call, a member access, an interpolated template, and a
  class token cut by an interpolation (`` `bg-${tone}-500` ``).
- SVG presentation attributes (`<path fill="#fff" />`) and any other prop: only the configured
  class and style attributes are read.
- Strings that are not class strings, such as the selector in
  `el.querySelector('[data-state="open"]')` or `closest(...)`, even inside a `cn()` call.
- Custom property definitions in a style object (`style={{ '--progress': '40%' }}`).
- `createGlobalStyle` and other tags not in `cssTags`, where the tokens themselves are defined.
- Tests and stories (`*.test.*`, `*.spec.*`, `*.stories.*`, `__tests__/`), through the default
  `allowIn`.
- Object-style CSS-in-JS (`styled.div({ color: '#fff' })`, `css({ ... })`) and whole CSS files.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `categories` | `string[]` | all: `color`, `spacing`, `fontSize`, `fontFamily`, `radius`, `shadow`, `motion` | The kinds of design value to check. |
| `allowedVarPrefixes` | `string[]` | unset (any variable is a token) | Prefixes a token CSS variable starts with. When set, other variables are reported. |
| `allowedVars` | `string[]` | the five Base UI geometry variables | Variables allowed whatever their prefix. A configured list replaces the default. |
| `allowedValues` | `string[]` | `[]` | Class tokens (`text-white`) or CSS values (`1px`) that are always allowed. |
| `fontNames` | `string[]` | `[]` | Font names whose `font-<name>` utility is reported. |
| `classAttributes` | `string[]` | `["className", "class"]` | JSX attributes that hold class strings. |
| `classFunctions` | `string[]` | `["cn", "clsx", "classnames", "classNames", "cx", "cva", "tv", "twMerge", "twJoin"]` | Functions whose string arguments are class strings. |
| `styleAttributes` | `string[]` | `["style"]` | JSX attributes that hold an inline style object (add `sx` for MUI). |
| `checkStyleObjects` | `boolean` | `true` | Check inline style objects. |
| `cssTags` | `string[]` | `["styled", "css", "keyframes"]` | Tags of CSS-in-JS templates, matched on the name the tag starts with. |
| `allowIn` | `string[]` (globs) | tests and stories | Files the rule skips. A configured list replaces the default. |

```js
{
  files: ['packages/ui/src/**/*.tsx'],
  rules: {
    'noctcore-react/no-hardcoded-design-values': ['error', {
      allowedVarPrefixes: ['--color-', '--radius-', '--space-', '--font-', '--shadow-', '--motion-'],
      allowedVars: ['--transform-origin', '--anchor-width', '--available-height'],
      fontNames: ['inter'],
    }],
  },
}
```

## When not to use it

In an application that styles with the Tailwind palette and literal values on purpose, or in a
package with no design tokens to point at, every report is a rewrite with nothing to rewrite to.
Leave it off there.
