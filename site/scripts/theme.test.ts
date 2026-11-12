/**
 * The inspection-sheet token contract, checked on the files this site ships.
 *
 * - Every `--sheet-*` custom property a stylesheet reads (src/styles/*.css and
 *   the `<style>` blocks of src/components/*.astro) is set for light (`:root`)
 *   and for dark (`:root[data-theme='dark']`). A token a theme forgets does not
 *   fail the build: the `var()` resolves to nothing and a colour silently
 *   drops out, so this is the only thing that notices.
 * - Every colour token is an `oklch()` literal, and every declared text and
 *   background pair meets WCAG AA in both themes, computed from those values.
 * - The code theme's hex colours are the code tokens, converted.
 * - The phone block holds the 16px gutter, the drawer and the scroll rules.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const STYLES = join(SRC, 'styles');
const COMPONENTS = join(SRC, 'components');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const readStyle = (file: string) => stripComments(readFileSync(join(STYLES, file), 'utf8'));

/** Every stylesheet the site loads, plus the scoped styles of its components. */
function siteCss(): string {
  const sheets = readdirSync(STYLES)
    .filter((file) => file.endsWith('.css'))
    .map(readStyle);
  const scoped = readdirSync(COMPONENTS)
    .filter((file) => file.endsWith('.astro'))
    .flatMap((file) =>
      [...readFileSync(join(COMPONENTS, file), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) =>
        stripComments(m[1]!),
      ),
    );
  return [...sheets, ...scoped].join('\n');
}

interface CssRule {
  readonly selector: string;
  readonly body: string;
  readonly media: string | null;
}

/** Top-level rules, and the rules one level inside an `@media` block. */
function parseRules(css: string, media: string | null = null): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const head = css.slice(i, open);
    const selector = head.slice(Math.max(head.lastIndexOf(';'), head.lastIndexOf('}')) + 1).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (selector.startsWith('@media')) rules.push(...parseRules(body, selector));
    else if (!selector.startsWith('@')) rules.push({ selector, body, media });
    i = j;
  }
  return rules;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return out;
}

const firstSelector = (rule: CssRule) => rule.selector.split(',')[0]!.trim();

type Theme = Map<string, string>;

/** The `--sheet-*` values of each theme, from tokens.css. */
function themes(tokensCss: string): { light: Theme; dark: Theme } {
  const light: Theme = new Map();
  const dark: Theme = new Map();
  for (const rule of parseRules(tokensCss)) {
    if (rule.media !== null) continue;
    const target = firstSelector(rule) === ':root' ? light : firstSelector(rule) === ":root[data-theme='dark']" ? dark : null;
    if (!target) continue;
    for (const [name, value] of declarations(rule.body)) if (name.startsWith('--sheet-')) target.set(name, value);
  }
  return { light, dark };
}

const readsOf = (css: string) => new Set([...css.matchAll(/var\(\s*(--sheet-[\w-]+)/g)].map((m) => m[1]!));

/**
 * Tokens with one value for both themes: type, shape, and the code panel
 * colours (the panels are dark ink in both themes; only their background and
 * hairline deepen in dark).
 */
const MODE_INDEPENDENT = new Set([
  '--sheet-font-display',
  '--sheet-font-ui',
  '--sheet-font-code',
  '--sheet-radius',
  '--sheet-code-fg',
  '--sheet-code-dim',
  '--sheet-code-kw',
  '--sheet-code-str',
  '--sheet-code-num',
  '--sheet-code-fn',
  '--sheet-code-squiggle',
]);

/** Tokens whose value is not one colour. */
const NOT_A_COLOUR = new Set(['--sheet-font-display', '--sheet-font-ui', '--sheet-font-code', '--sheet-radius', '--sheet-shadow']);

function missingTokens(css: string, tokensCss: string): { light: string[]; dark: string[] } {
  const { light, dark } = themes(tokensCss);
  const needed = [...readsOf(css)].sort();
  return {
    light: needed.filter((token) => !light.has(token)),
    dark: needed.filter((token) => !MODE_INDEPENDENT.has(token) && !dark.has(token)),
  };
}

const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/;

function parseOklch(value: string): [number, number, number] {
  const m = OKLCH.exec(value);
  if (!m) throw new Error(`not an oklch() literal: ${value}`);
  return [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
}

/** OKLCH to linear sRGB, clamped to the gamut (Ottosson's matrices). */
function linearSrgb([L, C, h]: [number, number, number]): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function luminance(value: string): number {
  const [r, g, b] = linearSrgb(parseOklch(value));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(value: string): string {
  const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${linearSrgb(parseOklch(value))
    .map((c) => Math.round(encode(c) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

interface Pair {
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}

/**
 * Every text and background pair the site declares: 4.5 for body text, 3 for
 * large text, UI edges and the focus ring.
 */
const PAIRS: readonly Pair[] = [
  ...['ink', 'ink-2', 'ink-3'].flatMap((fg) => ['bg', 'bg-2', 'bg-3'].map((bg) => ({ fg, bg, min: 4.5 }))),
  { fg: 'signal-ink', bg: 'bg', min: 4.5 },
  { fg: 'signal-ink', bg: 'bg-2', min: 4.5 },
  { fg: 'signal-ink', bg: 'bg-3', min: 4.5 },
  { fg: 'signal-ink', bg: 'signal-wash', min: 4.5 },
  { fg: 'pass', bg: 'bg', min: 4.5 },
  { fg: 'pass', bg: 'pass-wash', min: 4.5 },
  { fg: 'ink-2', bg: 'pass-wash', min: 4.5 },
  { fg: 'on-signal', bg: 'signal-fill', min: 4.5 },
  { fg: 'bg', bg: 'ink', min: 4.5 },
  ...['code-fg', 'code-dim', 'code-kw', 'code-str', 'code-num', 'code-fn', 'code-squiggle'].map((fg) => ({
    fg,
    bg: 'code-bg',
    min: 4.5,
  })),
  { fg: 'code-fg', bg: 'code-bg-2', min: 4.5 },
  { fg: 'code-dim', bg: 'code-bg-2', min: 4.5 },
  { fg: 'code-squiggle', bg: 'code-bg-2', min: 4.5 },
  { fg: 'field-line', bg: 'bg', min: 3 },
  { fg: 'focus', bg: 'bg', min: 3 },
  { fg: 'signal', bg: 'bg', min: 3 },
  { fg: 'signal-fill', bg: 'bg', min: 3 },
].map((pair) => ({ ...pair, fg: `--sheet-${pair.fg}`, bg: `--sheet-${pair.bg}` }));

function contrastFailures(tokensCss: string, pairs: readonly Pair[]): string[] {
  const { light, dark } = themes(tokensCss);
  const failures: string[] = [];
  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    const valueOf = (token: string) => theme.get(token) ?? light.get(token);
    for (const { fg, bg, min } of pairs) {
      const [a, b] = [valueOf(fg), valueOf(bg)];
      if (a === undefined || b === undefined) {
        failures.push(`${name}: ${fg} on ${bg} has no value`);
        continue;
      }
      const ratio = contrast(a, b);
      if (ratio < min) failures.push(`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  return failures;
}

describe('inspection-sheet token contract', () => {
  const tokens = readStyle('tokens.css');
  const css = siteCss();

  test('the stylesheets read sheet tokens at all (the parse is not vacuous)', () => {
    const reads = readsOf(css);
    for (const token of ['--sheet-ink', '--sheet-bg', '--sheet-code-bg', '--sheet-signal', '--sheet-scrim']) {
      expect(reads).toContain(token);
    }
    const { light, dark } = themes(tokens);
    expect(light.size).toBeGreaterThan(25);
    expect(dark.size).toBeGreaterThan(15);
  });

  test("every token the site reads is set in light (:root) and dark (:root[data-theme='dark'])", () => {
    expect(missingTokens(css, tokens)).toEqual({ light: [], dark: [] });
  });

  test('a token dropped from either theme is reported', () => {
    const noDarkInk3 = tokens.replace(/(:root\[data-theme='dark'\][\s\S]*?)--sheet-ink-3:[^;]*;/, '$1');
    expect(missingTokens(css, noDarkInk3)).toEqual({ light: [], dark: ['--sheet-ink-3'] });
    const noRadius = tokens.replace(/--sheet-radius:[^;]*;/, '');
    expect(missingTokens(css, noRadius)).toEqual({ light: ['--sheet-radius'], dark: [] });
  });

  test('every colour token is an oklch() literal', () => {
    const { light, dark } = themes(tokens);
    const notOklch = [...light, ...dark]
      .filter(([name, value]) => !NOT_A_COLOUR.has(name) && !OKLCH.test(value))
      .map(([name, value]) => `${name}: ${value}`);
    expect(notOklch).toEqual([]);
    expect(() => parseOklch('var(--sheet-ink)')).toThrow('not an oklch() literal');
  });

  test('every declared text and background pair meets WCAG AA in both themes', () => {
    expect(PAIRS.length).toBeGreaterThan(25);
    expect(contrastFailures(tokens, PAIRS)).toEqual([]);
  });

  test('a failing pair is reported', () => {
    const { light } = themes(tokens);
    const ink3OnBg = tokens.replace(/--sheet-ink-3:[^;]*;/, `--sheet-ink-3: ${light.get('--sheet-bg')};`);
    expect(contrastFailures(ink3OnBg, [{ fg: '--sheet-ink-3', bg: '--sheet-bg', min: 4.5 }])).toEqual([
      'light: --sheet-ink-3 on --sheet-bg is 1.00:1, needs 4.5:1',
    ]);
  });

  test('the code theme colours are the code tokens, converted', () => {
    const { light } = themes(tokens);
    const source = readFileSync(join(STYLES, 'code-theme.mjs'), 'utf8');
    const colours = [...source.matchAll(/'(--sheet-code-[\w-]+)':\s*'(#[0-9a-f]{6})'/g)];
    expect(colours.length).toBeGreaterThanOrEqual(7);
    for (const [, token, hex] of colours) {
      const expected = toHex(light.get(token!)!);
      const channels = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const drift = channels(hex!).map((c, i) => Math.abs(c - channels(expected)[i]!));
      expect({ token, drift: Math.max(...drift) <= 1 }).toEqual({ token, drift: true });
    }
  });
});

describe('phone layout rules', () => {
  const phone = parseRules(readStyle('layout.css')).filter((rule) => rule.media?.replace(/\s+/g, ' ') === '@media (max-width: 45rem)');
  const ruleWith = (pick: (rule: CssRule) => boolean, property: string, value?: string) =>
    phone.some((rule) => {
      if (!pick(rule)) return false;
      const actual = declarations(rule.body).get(property);
      return value === undefined ? actual !== undefined : actual === value;
    });
  const selectors = (rule: CssRule) => rule.selector.split(',').map((s) => s.trim());

  test('the phone block exists', () => {
    expect(phone.length).toBeGreaterThan(3);
  });

  test('the page gutter is 16px', () => {
    expect(ruleWith((rule) => selectors(rule).includes(':root'), '--sl-content-pad-x', '16px')).toBe(true);
  });

  test('navigation is a fixed drawer with its own width', () => {
    const drawer = (rule: CssRule) => selectors(rule).includes('.sidebar-pane');
    expect(ruleWith(drawer, 'position', 'fixed')).toBe(true);
    expect(ruleWith(drawer, 'width')).toBe(true);
  });

  test('code scrolls inside its panel and the page root does not scroll sideways', () => {
    expect(ruleWith((rule) => selectors(rule).some((s) => /(^|\s)pre$/.test(s)), 'overflow-x', 'auto')).toBe(true);
    expect(
      ruleWith((rule) => selectors(rule).includes('html') || selectors(rule).includes('body'), 'overflow-x', 'clip'),
    ).toBe(true);
  });
});
