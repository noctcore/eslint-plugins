---
'@noctcore/eslint-plugin-react': minor
---

Add the opt-in `no-hardcoded-design-values` rule for design system and UI library packages that theme through tokens. It reports hardcoded colours, spacing, font sizes, font families, radii, shadows and motion in three places: class strings (`className` / `class` and every string passed to `cn`, `clsx`, `classnames`, `cx`, `cva`, `tv`, `twMerge`, `twJoin`), inline `style` objects, and CSS-in-JS tagged templates (`styled.*`, `styled(...)`, `css`, `keyframes`). In class strings it reports Tailwind palette utilities (`bg-blue-500`, `text-white`) and arbitrary values that hardcode a design value (`rounded-[6px]`, `text-[#fff]`, `p-[13px]`, `duration-[200ms]`, `font-['Inter']`). In styles and templates it reports a literal raw colour, non-zero length, shadow, font name, duration or `cubic-bezier()` curve on a property of those categories.

Theme-scale utilities (`bg-primary`, `p-4`, `rounded-md`), arbitrary values for geometry (`w-[200px]`), `0`, percentages, `inherit`, `currentColor`, `transparent`, values the rule cannot read, SVG attributes, DOM query strings, and tests and stories (default `allowIn`) are left alone. Any CSS variable is a token unless `allowedVarPrefixes` is set; then other variables are reported, except `allowedVars` (by default the runtime geometry variables Base UI sets). Other options: `categories`, `allowedValues`, `fontNames`, `classAttributes`, `classFunctions`, `styleAttributes`, `checkStyleObjects`, `cssTags`.

The rule is not in `recommended` or `strict`, so a project spreading either preset sees no new errors. Enable it for the component package with `'noctcore-react/no-hardcoded-design-values': 'error'`.

Arithmetic on a token (`calc(var(--radius) - 2px)`, `min(var(--radius-md), 10px)`), `url(...)` references such as `url(#fade)`, and `//` comments in CSS templates are not reported.
