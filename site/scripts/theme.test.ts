/**
 * The noctcore theme's token contract, checked on the files this site ships:
 * every `--nc-*` custom property that base.css and components.css read is set
 * by the Nocturne preset, for dark (`:root`) and for light
 * (`:root[data-theme='light']`). A token the preset forgets does not fail the
 * build: the `var()` just resolves to nothing and a colour silently drops out,
 * so this is the only thing that notices.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'noctcore');
const read = (file: string) => readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Tokens with one value for both modes (the theme README's "Type, shape and
 * labels"): the preset sets them once on `:root` and light inherits them.
 */
const MODE_INDEPENDENT = new Set([
  '--nc-font-display',
  '--nc-font-body',
  '--nc-font-mono',
  '--nc-label-font',
  '--nc-label-case',
  '--nc-label-tracking',
  '--nc-label-size',
  '--nc-label-weight',
  '--nc-radius',
  '--nc-measure',
]);

const readsOf = (css: string) => new Set([...css.matchAll(/var\(\s*(--nc-[\w-]+)/g)].map((m) => m[1]!));
const setsOf = (css: string) => new Set([...css.matchAll(/(--nc-[\w-]+)\s*:/g)].map((m) => m[1]!));

/** The declarations inside the first block whose selector list starts with `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector},`);
  if (start === -1) throw new Error(`no "${selector}" block in the preset`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function missingTokens(base: string, components: string, preset: string): { dark: string[]; light: string[] } {
  // Tokens base.css or components.css set themselves (the brand constants, a
  // badge's own colours, a frame's unit) are not the preset's to provide.
  const local = new Set([...setsOf(base), ...setsOf(components)]);
  const needed = [...new Set([...readsOf(base), ...readsOf(components)])].filter((token) => !local.has(token)).sort();
  const dark = setsOf(block(preset, ':root'));
  const light = setsOf(block(preset, ":root[data-theme='light']"));
  return {
    dark: needed.filter((token) => !dark.has(token)),
    light: needed.filter((token) => !MODE_INDEPENDENT.has(token) && !light.has(token)),
  };
}

describe('noctcore theme token contract', () => {
  const base = read('base.css');
  const components = read('components.css');
  const preset = read('presets/nocturne.css');

  test('the two shared files read tokens at all (the parse is not vacuous)', () => {
    expect(readsOf(base)).toContain('--nc-ink');
    expect(readsOf(base)).toContain('--nc-success-edge');
    expect(readsOf(components)).toContain('--nc-card-bg');
    expect(readsOf(components)).toContain('--nc-motif');
  });

  test('Nocturne sets every token base.css and components.css read, in dark and in light', () => {
    expect(missingTokens(base, components, preset)).toEqual({ dark: [], light: [] });
  });

  test('a token dropped from either mode is reported', () => {
    const noLightEdge = preset.replace(
      /(:root\[data-theme='light'\][\s\S]*?)--nc-success-edge:[^;]*;/,
      '$1',
    );
    expect(missingTokens(base, components, noLightEdge)).toEqual({ dark: [], light: ['--nc-success-edge'] });
    const noDarkRadius = preset.replace(/--nc-radius:[^;]*;/, '');
    expect(missingTokens(base, components, noDarkRadius)).toEqual({ dark: ['--nc-radius'], light: [] });
  });
});
