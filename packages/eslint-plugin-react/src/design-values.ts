/*
 * The detector behind `no-hardcoded-design-values`, kept apart from the AST
 * walking: it reads one Tailwind class token or one CSS declaration and says
 * which design value, if any, it hardcodes. Pure string work, no ESLint.
 *
 * A design value is a colour, spacing, font size, font family, radius, shadow
 * or motion (duration, delay, easing curve). It is "hardcoded" when it is
 * written as a literal rather than taken from a token: a CSS variable, or a
 * Tailwind utility on the theme scale (`bg-primary`, `p-4`, `rounded-md`). What
 * stays allowed everywhere: `0`, percentages, `inherit` and the other global
 * keywords, `currentColor`, `transparent`, `none`, `auto`.
 */

export type DesignCategory =
  | 'color'
  | 'spacing'
  | 'fontSize'
  | 'fontFamily'
  | 'radius'
  | 'shadow'
  | 'motion';

export const DESIGN_CATEGORIES: readonly DesignCategory[] = [
  'color',
  'spacing',
  'fontSize',
  'fontFamily',
  'radius',
  'shadow',
  'motion',
];

/** How a category reads in a message. */
export const CATEGORY_LABELS: Readonly<Record<DesignCategory, string>> = {
  color: 'colour',
  spacing: 'spacing',
  fontSize: 'font size',
  fontFamily: 'font family',
  radius: 'radius',
  shadow: 'shadow',
  motion: 'motion',
};

/** One hardcoded value found in a token or declaration. */
export type DesignFinding =
  | { readonly kind: 'palette' }
  | { readonly kind: 'fontName' }
  | { readonly kind: 'value'; readonly category: DesignCategory }
  | { readonly kind: 'variable'; readonly name: string };

/** What the detector needs from the rule's options. */
export interface DesignPolicy {
  readonly categories: ReadonlySet<DesignCategory>;
  /** `null`: any CSS variable is a token. Otherwise the prefixes a token variable starts with. */
  readonly varPrefixes: readonly string[] | null;
  readonly allowedVars: ReadonlySet<string>;
  readonly allowedValues: ReadonlySet<string>;
  readonly fontNames: ReadonlySet<string>;
}

// Tailwind's colour families (v3 and v4, including the v4.2 additions).
const PALETTE_FAMILIES =
  'slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

// Utilities that take a colour.
const COLOR_UTILITIES =
  'bg|text|border|border-[xytrblse]|outline|ring|ring-offset|inset-ring|shadow|inset-shadow|drop-shadow|text-shadow|fill|stroke|from|via|to|divide|placeholder|accent|caret|decoration';

const PALETTE_CLASS = new RegExp(
  `^(?:${COLOR_UTILITIES})-(?:(?:${PALETTE_FAMILIES})-(?:50|[1-9]00|950)|black|white)(?:/\\S+)?$`,
  'u',
);

const COLOR_UTILITY = new RegExp(`^(?:${COLOR_UTILITIES})$`, 'u');
const SPACING_UTILITY =
  /^(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)$/u;
const RADIUS_UTILITY = /^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?$/u;
const SHADOW_UTILITY = /^(?:shadow|inset-shadow|drop-shadow|text-shadow)$/u;
const MOTION_UTILITY = /^(?:duration|delay|ease|animate)$/u;

// The 148 CSS named colours, minus `transparent` and `currentcolor`, which are allowed.
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen'
  ).split(' '),
);

const HEX_COLOR = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z])/iu;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/iu;
// A non-zero length. Percentages are geometry, not tokens, and stay allowed.
const LENGTH = /(?<![\w.-])-?((?:\d*\.)?\d+)(?:px|rem|em|pt|pc|cm|mm|in|vh|vw|vmin|vmax|svh|lvh|dvh|ch|ex|lh|rlh)\b/giu;
const DURATION = /(?<![\w.-])((?:\d*\.)?\d+)m?s\b/giu;
const EASING_FUNCTION = /\b(?:cubic-bezier|steps|linear)\(/iu;
const CSS_VARIABLE = /var\(\s*(--[\w-]+)/gu;
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);
const GLOBAL_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'none',
  'auto',
  'currentcolor',
  'transparent',
  'normal',
]);

/** The CSS property (kebab-case) to the category its value is checked for. */
const PROPERTY_CATEGORIES: ReadonlyMap<string, DesignCategory> = new Map(
  (
    [
      ['color', 'color background background-color background-image border-color border-top-color border-right-color border-bottom-color border-left-color border-inline-color border-block-color border-inline-start-color border-inline-end-color border border-top border-right border-bottom border-left border-inline border-block outline outline-color fill stroke caret-color accent-color text-decoration-color text-decoration column-rule-color'],
      ['spacing', 'padding padding-top padding-right padding-bottom padding-left padding-inline padding-block padding-inline-start padding-inline-end padding-block-start padding-block-end margin margin-top margin-right margin-bottom margin-left margin-inline margin-block margin-inline-start margin-inline-end margin-block-start margin-block-end gap row-gap column-gap'],
      ['fontSize', 'font-size font'],
      ['fontFamily', 'font-family'],
      ['radius', 'border-radius border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius'],
      ['shadow', 'box-shadow text-shadow'],
      ['motion', 'transition transition-duration transition-delay transition-timing-function animation animation-duration animation-delay animation-timing-function'],
    ] as const
  ).flatMap(([category, names]) => names.split(' ').map((name) => [name, category] as const)),
);

/** `borderTopColor` → `border-top-color`; a kebab name is returned as is. */
export function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

/** The category a CSS property's value is checked for, or null. */
export function propertyCategory(property: string): DesignCategory | null {
  return PROPERTY_CATEGORIES.get(toKebabCase(property).toLowerCase()) ?? null;
}

/** Remove every `var(...)`, fallbacks included, so only the literal part is left. */
function stripVariables(value: string): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('var(', index);
    if (start === -1) {
      result += value.slice(index);
      break;
    }
    result += `${value.slice(index, start)} `;
    let depth = 0;
    let end = start + 3;
    for (; end < value.length; end += 1) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    index = end + 1;
  }
  return result;
}

/** The custom properties a value reads through `var(--x)`. */
function variablesIn(value: string): string[] {
  return [...value.matchAll(CSS_VARIABLE)].map((match) => match[1] as string);
}

function hasColor(value: string): boolean {
  if (HEX_COLOR.test(value) || COLOR_FUNCTION.test(value)) {
    return true;
  }
  // Named colours only as whole words, and never inside a url().
  const words = value.replace(/url\([^)]*\)/giu, ' ').toLowerCase().split(/[^a-z-]+/u);
  return words.some((word) => NAMED_COLORS.has(word));
}

function hasFontFamilyName(value: string): boolean {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/gu, '').toLowerCase())
    .some((part) => part !== '' && !GENERIC_FONT_FAMILIES.has(part) && !GLOBAL_KEYWORDS.has(part));
}

/** True when `pattern` (global, number in group 1) matches a non-zero number in `value`. */
function hasNonZero(pattern: RegExp, value: string): boolean {
  return [...value.matchAll(pattern)].some((match) => Number(match[1]) !== 0);
}

/** True when the literal part of `value` hardcodes a value of `category`. */
function hardcodes(category: DesignCategory, value: string): boolean {
  switch (category) {
    case 'color':
      return hasColor(value);
    case 'spacing':
    case 'fontSize':
    case 'radius':
      return hasNonZero(LENGTH, value);
    case 'shadow':
      return hasNonZero(LENGTH, value) || hasColor(value);
    case 'motion':
      return hasNonZero(DURATION, value) || EASING_FUNCTION.test(value);
    case 'fontFamily':
      return hasFontFamilyName(value);
  }
}

/** The variables `value` reads that are not tokens under the policy. */
function disallowedVariables(value: string, policy: DesignPolicy): string[] {
  const prefixes = policy.varPrefixes;
  if (prefixes === null) {
    return [];
  }
  return variablesIn(value).filter(
    (name) => !policy.allowedVars.has(name) && !prefixes.some((prefix) => name.startsWith(prefix)),
  );
}

/**
 * Check one CSS value of a property already mapped to `category` (null for a
 * property outside every category, which is only checked for variables).
 */
export function checkCssValue(
  category: DesignCategory | null,
  rawValue: string,
  policy: DesignPolicy,
): DesignFinding[] {
  const value = rawValue.trim();
  if (value === '' || policy.allowedValues.has(value)) {
    return [];
  }
  const findings: DesignFinding[] = disallowedVariables(value, policy).map((name) => ({
    kind: 'variable' as const,
    name,
  }));
  if (category !== null && policy.categories.has(category)) {
    const literal = stripVariables(value).replace(/!important/giu, '');
    if (!GLOBAL_KEYWORDS.has(literal.trim().toLowerCase()) && hardcodes(category, literal)) {
      findings.push({ kind: 'value', category });
    }
  }
  return findings;
}

/** Split `hover:md:bg-red-500` into its variants and its utility, respecting brackets. */
function baseUtility(token: string): string {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) cut = index;
  }
  return token.slice(cut + 1).replace(/^!|!$/gu, '');
}

// `utility-[value]` with an optional `/opacity`, and the v4 `utility-(--var)` shorthand.
const ARBITRARY_VALUE = /^-?([a-z][a-z0-9-]*?)-\[(.+)\](?:\/\S+)?$/u;
const VARIABLE_SHORTHAND = /^-?([a-z][a-z0-9-]*?)-\((?:[a-z-]+:)?(--[\w-]+)\)(?:\/\S+)?$/u;
const ARBITRARY_PROPERTY = /^\[([a-z-]+):(.+)\]$/u;
const TYPE_HINT = /^([a-z-]+):(.+)$/u;

/** The category an arbitrary value of `utility` is checked for, given the value (and its type hint). */
function arbitraryCategory(utility: string, value: string, hint: string | null): DesignCategory | null {
  // `shadow-[0_1px_2px_#000]` is a shadow; `shadow-[#000]` only sets its colour.
  if (SHADOW_UTILITY.test(utility) && hint !== 'color' && hasNonZero(LENGTH, value)) {
    return 'shadow';
  }
  if (COLOR_UTILITY.test(utility) && (hint === 'color' || hasColor(value))) {
    return 'color';
  }
  if (utility === 'text') {
    return hint === null || hint === 'length' ? 'fontSize' : null;
  }
  if (utility === 'font') {
    // `font-[550]` is a weight.
    return hint === 'family-name' || (hint === null && !/^\d+$/u.test(value)) ? 'fontFamily' : null;
  }
  if (SPACING_UTILITY.test(utility)) return 'spacing';
  if (RADIUS_UTILITY.test(utility)) return 'radius';
  if (SHADOW_UTILITY.test(utility)) return 'shadow';
  if (MOTION_UTILITY.test(utility)) return 'motion';
  return null;
}

/** Check one class token (`hover:bg-[#fff]`). */
export function checkClassToken(token: string, policy: DesignPolicy): DesignFinding[] {
  if (policy.allowedValues.has(token)) {
    return [];
  }
  const utility = baseUtility(token);
  if (utility === '' || policy.allowedValues.has(utility)) {
    return [];
  }
  if (policy.categories.has('color') && PALETTE_CLASS.test(utility)) {
    return [{ kind: 'palette' }];
  }
  if (policy.categories.has('fontFamily') && utility.startsWith('font-')) {
    if (policy.fontNames.has(utility.slice('font-'.length).toLowerCase())) {
      return [{ kind: 'fontName' }];
    }
  }
  const shorthand = VARIABLE_SHORTHAND.exec(utility);
  if (shorthand !== null) {
    return checkCssValue(null, `var(${shorthand[2] as string})`, policy);
  }
  const property = ARBITRARY_PROPERTY.exec(utility);
  if (property !== null) {
    const name = property[1] as string;
    return checkCssValue(propertyCategory(name), (property[2] as string).replace(/_/gu, ' '), policy);
  }
  const arbitrary = ARBITRARY_VALUE.exec(utility);
  if (arbitrary === null) {
    return [];
  }
  const name = arbitrary[1] as string;
  let value = (arbitrary[2] as string).replace(/_/gu, ' ');
  let hint: string | null = null;
  const hinted = TYPE_HINT.exec(value);
  if (hinted !== null && !value.startsWith('var(')) {
    hint = hinted[1] as string;
    value = hinted[2] as string;
  }
  // `w-[--x]` is v3's shorthand for `var(--x)`.
  if (/^--[\w-]+$/u.test(value)) {
    value = `var(${value})`;
  }
  return checkCssValue(arbitraryCategory(name, value, hint), value, policy);
}

/** The declarations of a CSS block, comments removed: `[property, value]` pairs. */
export function cssDeclarations(css: string): Array<readonly [string, string]> {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, ' ');
  const declarations: Array<readonly [string, string]> = [];
  for (const match of text.matchAll(/(?:^|[;{}\s])(-?[a-z][a-z-]*)\s*:\s*([^;{}]+)/gu)) {
    declarations.push([match[1] as string, match[2] as string]);
  }
  return declarations;
}
