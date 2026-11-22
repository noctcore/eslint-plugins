import { ruleTester } from '@noctcore/eslint-test-utils';

import { noHardcodedDesignValuesRule } from '../../src/rules/no-hardcoded-design-values';

const TSX = 'src/components/Button.tsx';
const prefixes = [{ allowedVarPrefixes: ['--color-', '--radius-'] }];

ruleTester.run('no-hardcoded-design-values', noHardcodedDesignValuesRule, {
  valid: [
    // Theme-scale utilities are tokens.
    { code: `<button className="bg-primary text-primary-foreground rounded-md p-4 text-sm shadow-lg duration-200 ease-out font-sans" />`, filename: TSX },
    // Variants, arbitrary variants and data attributes around token utilities.
    { code: `<div className="hover:bg-accent data-[state=open]:bg-muted [&>svg]:size-4 md:dark:text-foreground" />`, filename: TSX },
    // Allowed keywords and zero.
    { code: `<div className="bg-transparent text-current border-current bg-inherit p-[0] m-[0px] rounded-[0]" />`, filename: TSX },
    // Arbitrary values for geometry are not design values.
    { code: `<div className="w-[200px] h-[calc(100vh-4rem)] grid-cols-[1fr_2fr] top-[3px] translate-x-[2px] z-[60] bg-[url(/hero.png)] border-[1px]" />`, filename: TSX },
    // CSS variables, in every Tailwind spelling.
    { code: `<div className="bg-(--color-surface) text-[var(--color-fg)] rounded-[var(--radius-md)] p-[var(--space-3)] bg-[color:var(--brand)] duration-[var(--motion-fast)]" />`, filename: TSX },
    // A var() fallback is not read.
    { code: `<div className="rounded-[var(--radius,6px)]" />`, filename: TSX },
    // Arithmetic on a token derives from it: the literal offset is not a second value.
    { code: `<div className="rounded-[calc(var(--radius)-2px)] rounded-t-[calc(var(--radius)_-_4px)] mt-[calc(var(--header)+1px)] p-[max(var(--space-2),8px)] text-[clamp(1rem,var(--fluid),2rem)]" />`, filename: TSX },
    { code: `<div style={{ borderRadius: 'min(var(--radius-md), 10px)', padding: 'calc(var(--space-2) * 2 + 1px)' }} />`, filename: TSX },
    // SVG fragment references and file names in url() are not colours.
    { code: `<svg className="fill-[url(#fade)] stroke-[url(#a1b2c3)]"><rect style={{ fill: 'url(#a1b2c3)', stroke: 'url(#red)' }} /></svg>`, filename: TSX },
    { code: `<div style={{ background: 'url(/img/beef.png)' }} />`, filename: TSX },
    // Many unclosed url( stay linear and hide nothing after them as a colour.
    { name: 'many unclosed url( in one value', code: `<div style={{ background: '${'url(#abc '.repeat(20000)}' }} />`, filename: TSX },
    // Line comments in a CSS template are not declarations; a // inside url() or a string is not a comment.
    { code: 'const Box = styled.div`\n  // color: red;\n  color: var(--color-fg); // was #333\n  background-image: url(https://cdn.example.com/a.png);\n  content: "//";\n`;', filename: TSX },
    // Font weight, not a family.
    { code: `<p className="font-[550]" />`, filename: TSX },
    // Not class strings at all: SVG presentation attributes and other props.
    { code: `<svg><path fill="#fff" stroke="currentColor" strokeWidth={2} /></svg>`, filename: TSX },
    { code: `<Chart color="#ff0000" />`, filename: TSX },
    // DOM query strings are not class strings.
    { code: `el.querySelector('[data-slot="row"]'); el.closest('[data-state="open"]'); el.matches('[aria-selected="true"]');`, filename: TSX },
    { code: `cn(el.closest('[data-state="open"]') && 'bg-accent');`, filename: TSX },
    // Interpolation splits a token: the parts are not read.
    { code: 'const c = `bg-${tone}-500 text-${tone}-50`; <div className={`bg-${tone}-500`} />;', filename: TSX },
    // Identifiers and calls are not read.
    { code: `<div className={styles.root} style={theme.box} />`, filename: TSX },
    // Inline styles: tokens, keywords, zero, percentages, unitless and non-design properties.
    {
      code: `<div style={{ color: 'var(--color-fg)', padding: 0, borderRadius: '50%', margin: '0px', fontFamily: 'inherit', background: 'transparent', borderColor: 'currentColor', width: 200, height: '40px', opacity: 0.5, zIndex: 10, lineHeight: 1.5, transitionTimingFunction: 'ease-in-out', transition: 'opacity var(--duration-fast) var(--ease-out)', fontFamily2: 'Inter' }} />`,
      filename: TSX,
    },
    { code: `<div style={{ '--progress': '40%', '--accent': '#ff0000' }} />`, filename: TSX },
    { code: `<div style={{ fontFamily: 'ui-monospace, monospace', boxShadow: 'none', transitionDuration: '0ms' }} />`, filename: TSX },
    // Non-literal style values are not read.
    { code: `<div style={{ color: tone, padding: space(2), borderRadius: \`\${r}px\` }} />`, filename: TSX },
    // CSS-in-JS with tokens and interpolations.
    { code: 'const Box = styled.div`\n  color: var(--color-fg);\n  padding: ${(p) => p.space}px;\n  border: 1px solid ${(p) => p.border};\n  width: 320px;\n`;', filename: TSX },
    // Global styles define the tokens and are not a configured tag.
    { code: 'const Global = createGlobalStyle`:root { --color-fg: #111; }`;', filename: TSX },
    // Tests and stories are skipped by default.
    { code: `<div className="bg-blue-500" />`, filename: 'src/components/Button.test.tsx' },
    { code: `<div className="bg-blue-500" />`, filename: 'src/components/Button.stories.tsx' },
    // allowIn replaces the default.
    { code: `<div className="bg-blue-500" />`, filename: 'src/legacy/Old.tsx', options: [{ allowIn: ['src/legacy/**'] }] },
    // allowedValues, as a token or a value.
    { code: `<div className="text-white" style={{ borderWidth: '1px', padding: '1px' }} />`, filename: TSX, options: [{ allowedValues: ['text-white', '1px'] }] },
    // A category turned off.
    { code: `<div className="p-[13px]" style={{ margin: 8 }} />`, filename: TSX, options: [{ categories: ['color'] }] },
    // Only configured attributes, functions and tags are read.
    { code: `<div tw="bg-blue-500" />; classes('bg-blue-500'); sx\`color: red\`;`, filename: TSX },
    { code: `<div style={{ color: '#fff' }} />`, filename: TSX, options: [{ checkStyleObjects: false }] },
    // With prefixes: token variables and the default runtime geometry variables pass.
    {
      code: `<div className="bg-(--color-surface) rounded-[var(--radius-md)] w-(--anchor-width) max-h-[var(--available-height)]" style={{ transformOrigin: 'var(--transform-origin)' }} />`,
      filename: TSX,
      options: prefixes,
    },
    // Without prefixes, any variable is a token.
    { code: `<div className="bg-(--brand) w-[var(--whatever)]" />`, filename: TSX },
  ],
  invalid: [
    // Tailwind palette utilities, with variants and opacity.
    {
      code: `<button className="bg-blue-500 hover:text-zinc-900 ring-red-400/50 text-white" />`,
      filename: TSX,
      errors: [
        { messageId: 'paletteClass', data: { token: 'bg-blue-500' } },
        { messageId: 'paletteClass', data: { token: 'hover:text-zinc-900' } },
        { messageId: 'paletteClass', data: { token: 'ring-red-400/50' } },
        { messageId: 'paletteClass', data: { token: 'text-white' } },
      ],
    },
    // A shadow colour on its own is a colour.
    {
      code: `<div className="shadow-[#000]" />`,
      filename: TSX,
      errors: [{ messageId: 'hardcodedClass', data: { token: 'shadow-[#000]', category: 'colour' } }],
    },
    // Arbitrary values for each category.
    {
      code: `<div className="rounded-[6px] duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-[#fafafa] font-['Inter'] p-[13px] -mt-[4px] text-[13px] bg-[oklch(0.7_0.1_200)]/50 border-x-[#e5e5e5] !bg-[red]" />`,
      filename: TSX,
      errors: [
        { messageId: 'hardcodedClass', data: { token: 'rounded-[6px]', category: 'radius' } },
        { messageId: 'hardcodedClass', data: { token: 'duration-[200ms]', category: 'motion' } },
        { messageId: 'hardcodedClass', data: { token: 'ease-[cubic-bezier(0.4,0,0.2,1)]', category: 'motion' } },
        { messageId: 'hardcodedClass', data: { token: 'shadow-[0_1px_2px_rgba(0,0,0,0.1)]', category: 'shadow' } },
        { messageId: 'hardcodedClass', data: { token: 'text-[#fafafa]', category: 'colour' } },
        { messageId: 'hardcodedClass', data: { token: "font-['Inter']", category: 'font family' } },
        { messageId: 'hardcodedClass', data: { token: 'p-[13px]', category: 'spacing' } },
        { messageId: 'hardcodedClass', data: { token: '-mt-[4px]', category: 'spacing' } },
        { messageId: 'hardcodedClass', data: { token: 'text-[13px]', category: 'font size' } },
        { messageId: 'hardcodedClass', data: { token: 'bg-[oklch(0.7_0.1_200)]/50', category: 'colour' } },
        { messageId: 'hardcodedClass', data: { token: 'border-x-[#e5e5e5]', category: 'colour' } },
        { messageId: 'hardcodedClass', data: { token: '!bg-[red]', category: 'colour' } },
      ],
    },
    // calc() without a variable is still a literal.
    {
      code: `<div className="rounded-[calc(6px+2px)]" style={{ padding: 'calc(4px * 3)' }} />`,
      filename: TSX,
      errors: [{ messageId: 'hardcodedClass', data: { token: 'rounded-[calc(6px+2px)]', category: 'radius' } }, { messageId: 'hardcodedStyle' }],
    },
    // A hex colour beside a url() is still read, and so is one before an unclosed url(.
    {
      code: `<div style={{ background: '#fff url(/a.png)', backgroundColor: 'red url(url(url(' }} />`,
      filename: TSX,
      errors: [
        { messageId: 'hardcodedStyle', data: { property: 'background', value: "'#fff url(/a.png)'", category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'backgroundColor', value: "'red url(url(url('", category: 'colour' } },
      ],
    },
    // A declaration after a line comment is still read.
    {
      code: 'const Box = styled.div`\n  // the brand blue\n  color: #1e40af;\n  background: url(http://x.test/a.png) #fff;\n`;',
      filename: TSX,
      errors: [
        { messageId: 'hardcodedStyle', data: { property: 'color', value: '#1e40af', category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'background', value: 'url(http://x.test/a.png) #fff', category: 'colour' } },
      ],
    },
    // Type hints and arbitrary properties.
    {
      code: `<div className="text-[length:15px] bg-[color:#000] [color:#333] [border-radius:4px]" />`,
      filename: TSX,
      errors: [
        { messageId: 'hardcodedClass', data: { token: 'text-[length:15px]', category: 'font size' } },
        { messageId: 'hardcodedClass', data: { token: 'bg-[color:#000]', category: 'colour' } },
        { messageId: 'hardcodedClass', data: { token: '[color:#333]', category: 'colour' } },
        { messageId: 'hardcodedClass', data: { token: '[border-radius:4px]', category: 'radius' } },
      ],
    },
    // Class helpers, branches, arrays and object keys.
    {
      code: `const button = cva('inline-flex bg-blue-600', { variants: { intent: { danger: 'bg-red-600', ghost: 'bg-transparent' } } });`,
      filename: TSX,
      errors: [{ messageId: 'paletteClass' }, { messageId: 'paletteClass' }],
    },
    {
      code: `<div className={cn('p-4', active ? 'bg-sky-100' : 'bg-muted', { 'text-rose-600': error }, ['rounded-[3px]'])} />`,
      filename: TSX,
      errors: [{ messageId: 'paletteClass' }, { messageId: 'paletteClass' }, { messageId: 'hardcodedClass' }],
    },
    {
      code: '<div className={`flex ${gap} bg-gray-50 ${x}`} />',
      filename: TSX,
      errors: [{ messageId: 'paletteClass', data: { token: 'bg-gray-50' } }],
    },
    // A configured font name.
    {
      code: `<h1 className="font-inter" />`,
      filename: TSX,
      options: [{ fontNames: ['Inter'] }],
      errors: [{ messageId: 'fontNameClass', data: { token: 'font-inter' } }],
    },
    // Inline styles.
    {
      code: `<div style={{ color: '#1e40af', backgroundColor: 'rgb(0 0 0 / 0.5)', borderRadius: 6, padding: '12px 16px', fontSize: 14, fontFamily: 'Inter, sans-serif', boxShadow: '0 1px 2px var(--shadow-color)', transition: 'opacity 200ms', animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)', border: '1px solid red' }} />`,
      filename: TSX,
      errors: [
        { messageId: 'hardcodedStyle', data: { property: 'color', value: "'#1e40af'", category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'backgroundColor', value: "'rgb(0 0 0 / 0.5)'", category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'borderRadius', value: '6', category: 'radius' } },
        { messageId: 'hardcodedStyle', data: { property: 'padding', value: "'12px 16px'", category: 'spacing' } },
        { messageId: 'hardcodedStyle', data: { property: 'fontSize', value: '14', category: 'font size' } },
        { messageId: 'hardcodedStyle', data: { property: 'fontFamily', value: "'Inter, sans-serif'", category: 'font family' } },
        { messageId: 'hardcodedStyle', data: { property: 'boxShadow', value: "'0 1px 2px var(--shadow-color)'", category: 'shadow' } },
        { messageId: 'hardcodedStyle', data: { property: 'transition', value: "'opacity 200ms'", category: 'motion' } },
        { messageId: 'hardcodedStyle', data: { property: 'animationTimingFunction', value: "'cubic-bezier(0.4, 0, 0.2, 1)'", category: 'motion' } },
        { messageId: 'hardcodedStyle', data: { property: 'border', value: "'1px solid red'", category: 'colour' } },
      ],
    },
    // Both branches of a style value, and a conditional style object.
    {
      code: `<div style={open ? { color: '#fff' } : { margin: active ? 4 : 'var(--space-1)' }} />`,
      filename: TSX,
      errors: [{ messageId: 'hardcodedStyle' }, { messageId: 'hardcodedStyle' }],
    },
    // A custom style attribute.
    {
      code: `<Box sx={{ color: 'tomato' }} />`,
      filename: TSX,
      options: [{ styleAttributes: ['style', 'sx'] }],
      errors: [{ messageId: 'hardcodedStyle', data: { property: 'color', value: "'tomato'", category: 'colour' } }],
    },
    // CSS-in-JS templates.
    {
      code: 'const Card = styled(Box).attrs({})`\n  /* card */\n  color: #333;\n  border-radius: 8px;\n  &:hover { background: hsl(210 40% 98%); }\n  transition: transform 150ms ease;\n`;',
      filename: TSX,
      errors: [
        { messageId: 'hardcodedStyle', data: { property: 'color', value: '#333', category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'border-radius', value: '8px', category: 'radius' } },
        { messageId: 'hardcodedStyle', data: { property: 'background', value: 'hsl(210 40% 98%)', category: 'colour' } },
        { messageId: 'hardcodedStyle', data: { property: 'transition', value: 'transform 150ms ease', category: 'motion' } },
      ],
    },
    {
      code: 'const focus = css`box-shadow: 0 0 0 2px ${ring};`;',
      filename: TSX,
      errors: [{ messageId: 'hardcodedStyle', data: { property: 'box-shadow', value: '0 0 0 2px ${...}', category: 'shadow' } }],
    },
    // Variables outside the token prefixes.
    {
      code: `<div className="bg-(--brand) text-[var(--fg)] w-[var(--sidebar-width)]" style={{ color: 'var(--legacy-fg)' }} />`,
      filename: TSX,
      options: prefixes,
      errors: [
        { messageId: 'disallowedVar', data: { name: '--brand', prefixes: '`--color-`, `--radius-`' } },
        { messageId: 'disallowedVar', data: { name: '--fg', prefixes: '`--color-`, `--radius-`' } },
        { messageId: 'disallowedVar', data: { name: '--sidebar-width', prefixes: '`--color-`, `--radius-`' } },
        { messageId: 'disallowedVar', data: { name: '--legacy-fg', prefixes: '`--color-`, `--radius-`' } },
      ],
    },
    // allowedVars replaces the default runtime list.
    {
      code: `<div className="w-(--anchor-width)" />`,
      filename: TSX,
      options: [{ allowedVarPrefixes: ['--color-'], allowedVars: ['--radix-popover-trigger-width'] }],
      errors: [{ messageId: 'disallowedVar' }],
    },
  ],
});
