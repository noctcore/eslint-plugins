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

/** An SVG file as markup to inline: no prolog, comments, style, title or fixed size, and no blank lines. */
export function inlineSvg(source: string, name: string, variant: 'wide' | 'narrow'): string {
  // Strip until nothing changes, so a removal cannot join the halves of a
  // new comment or style tag, then refuse anything that could still run.
  let svg = source;
  for (let previous = ''; previous !== svg; ) {
    previous = svg;
    svg = svg
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<title[\s\S]*?<\/title>/gi, '');
  }
  if (/<(!--|style|script|foreignObject)|\son[a-z]+=/i.test(svg)) {
    throw new Error(`The diagram ${name} holds markup a diagram may not: a comment, style, script or event handler`);
  }
  return svg
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
      const kept = attrs.replace(/\s(width|height|class|role|aria-[a-z]+)="[^"]*"/g, '');
      return `<svg${kept} class="d-svg d-svg--${variant}" data-diagram="${name}" aria-hidden="true" focusable="false">`;
    })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('');
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
