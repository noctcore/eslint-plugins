/**
 * Rule diagrams: hand-drawn SVG files that ship beside the rule docs, in
 * `packages/<pkg>/docs/diagrams/<name>.svg`, with an optional phone drawing
 * `<name>.narrow.svg`. A doc embeds one as a Markdown image,
 *
 *     ![Full text description.](../diagrams/layers.svg "The caption.")
 *
 * which GitHub shows as an image (the file carries its own colours for both
 * schemes). On the site, `scripts/sync.ts` and `RuleDiagram.astro` inline the
 * drawing instead, without its `<style>`, so the site's own classes
 * (`.d-*` in components.css) colour it from the theme tokens and it follows
 * the theme toggle. The description becomes the accessible name and the
 * "Text version" under the caption, since SVG text does not grow with a
 * text-only zoom.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Escape text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline Markdown of a caption: code spans and bold, everything else escaped. */
export function inlineMarkdown(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'),
    )
    .join('');
}

/** The elements and attributes a diagram may use; anything else is refused. */
const SVG_ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'line', 'path', 'text', 'tspan']);
const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'class', 'x', 'y', 'dx', 'dy', 'd', 'rx', 'ry', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2', 'text-anchor',
]);
const ATTRIBUTE = /\s+([a-zA-Z][a-zA-Z-]*)="([^"<>&]*)"/y;
const TEXT = /[^<&]+|&(?:amp|lt|gt|quot|#\d+);/y;

/**
 * An SVG file as markup to inline. The file is read once, token by token,
 * against an allow-list, and the output is rebuilt from the tokens: the
 * prolog and the shared style block are skipped, the root loses its fixed
 * size and gets the site's class, and any other element, attribute, comment
 * or entity throws. Diagrams are checked-in files, so refusing is the answer.
 */
export function inlineSvg(source: string, name: string, variant: 'wide' | 'narrow'): string {
  const refuse = (at: number): never => {
    throw new Error(`The diagram ${name} holds markup a diagram may not use, near: ${source.slice(at, at + 40)}`);
  };
  const out: string[] = [];
  const open: string[] = [];
  let i = 0;
  const skip = (pattern: RegExp): boolean => {
    pattern.lastIndex = i;
    const m = pattern.exec(source);
    if (m) i = pattern.lastIndex;
    return m !== null;
  };
  while (i < source.length) {
    if (/\s/.test(source[i]!) && open.length === 0) {
      i += 1;
      continue;
    }
    if (skip(/<\?xml [^<>]*\?>/y) || skip(/<style>[^<]*<\/style>/y)) continue;
    const tag = /<(\/?)([a-zA-Z]+)/y;
    tag.lastIndex = i;
    const m = tag.exec(source);
    if (m) {
      const [, closing, element] = m as unknown as [string, string, string];
      if (!SVG_ELEMENTS.has(element)) refuse(i);
      i = tag.lastIndex;
      if (closing) {
        if (open.pop() !== element || source[i] !== '>') refuse(i);
        i += 1;
        out.push(`</${element}>`);
        continue;
      }
      const attrs: string[] = [];
      for (;;) {
        ATTRIBUTE.lastIndex = i;
        const a = ATTRIBUTE.exec(source);
        if (!a) break;
        const [, key, value] = a as unknown as [string, string, string];
        if (!SVG_ATTRIBUTES.has(key)) refuse(i);
        i = ATTRIBUTE.lastIndex;
        if (element === 'svg' && (key === 'width' || key === 'height' || key === 'class')) continue;
        attrs.push(` ${key}="${value}"`);
      }
      if (element === 'svg') {
        if (open.length > 0) refuse(i);
        attrs.push(` class="d-svg d-svg--${variant}" data-diagram="${name}" aria-hidden="true" focusable="false"`);
      }
      const end = /\s*(\/?)>/y;
      end.lastIndex = i;
      const e = end.exec(source);
      if (!e) refuse(i);
      i = end.lastIndex;
      const selfClosing = e![1] === '/';
      out.push(`<${element}${attrs.join('')}${selfClosing ? '/' : ''}>`);
      if (!selfClosing) open.push(element);
      continue;
    }
    if (open.length === 0) refuse(i);
    TEXT.lastIndex = i;
    const t = TEXT.exec(source);
    if (!t) refuse(i);
    i = TEXT.lastIndex;
    // Whitespace between elements is layout in the file, not content.
    if (open.at(-1) === 'text' || open.at(-1) === 'tspan' || t![0].trim() !== '') out.push(t![0]);
  }
  if (open.length > 0 || out.length === 0) refuse(source.length);
  return out.join('');
}

export interface DiagramFigure {
  /** Absolute path of the wide drawing, `<name>.svg`. */
  readonly path: string;
  /** Everything the drawing shows, in sentences: the accessible name and the text version. */
  readonly description: string;
  /** The takeaway, one or two sentences. */
  readonly caption: string;
}

/** The narrow drawing beside a wide one, when there is one. */
export function narrowPathOf(path: string): string {
  return path.replace(/\.svg$/, '.narrow.svg');
}

/** The figure HTML for one diagram, on a single line so Markdown leaves it alone. */
export function diagramFigure({ path, description, caption }: DiagramFigure): string {
  if (!existsSync(path)) throw new Error(`diagram ${path} does not exist`);
  const name = basename(path, '.svg');
  const narrowPath = narrowPathOf(path);
  const drawings = [inlineSvg(readFileSync(path, 'utf8'), name, 'wide')];
  if (existsSync(narrowPath)) drawings.push(inlineSvg(readFileSync(narrowPath, 'utf8'), name, 'narrow'));
  const label = escapeHtml(description);
  return [
    `<figure class="rule-diagram not-content${drawings.length > 1 ? ' has-narrow' : ''}">`,
    `<div class="rule-diagram-plate" role="img" aria-label="${label}">${drawings.join('')}</div>`,
    '<figcaption>',
    `<p>${inlineMarkdown(caption)}</p>`,
    `<details><summary>Text version</summary><p>${inlineMarkdown(description)}</p></details>`,
    '</figcaption>',
    '</figure>',
  ].join('');
}

/** A Markdown image line that embeds a diagram: `![description](path.svg "caption")`. */
export const DIAGRAM_IMAGE = /^!\[([^\]]+)\]\((\.{1,2}\/[^)\s]+\.svg)(?:\s+"([^"]+)")?\)\s*$/;
