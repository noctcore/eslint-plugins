/**
 * Text edits over node ranges. A transform plans its edits against the parsed
 * case and applies them in one pass, so every edit sees the original offsets.
 * Copying the untouched text verbatim keeps comments (the `// expect:` labels
 * and `// ok`) exactly where they were relative to the code around them.
 */
import { parentOf, textOf, type Node, type Parsed } from './ast';

export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function insertAt(offset: number, text: string): Edit {
  return { start: offset, end: offset, text };
}

export function replaceRange(range: readonly [number, number], text: string): Edit {
  return { start: range[0], end: range[1], text };
}

/** Applies edits planned against `source`; null when two of them overlap. */
export function applyEdits(source: string, edits: readonly Edit[]): string | null {
  const sorted = edits
    .map((edit, order) => ({ edit, order }))
    .sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.order - b.order)
    .map((e) => e.edit);
  let out = '';
  let at = 0;
  let previous: Edit | null = null;
  for (const edit of sorted) {
    // The same edit planned twice (a JSX closing tag the scope manager also reports) applies once.
    if (previous !== null && edit.start === previous.start && edit.end === previous.end && edit.text === previous.text) continue;
    previous = edit;
    if (edit.start < at) return null;
    out += source.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + source.slice(at);
}

/**
 * The property a node is the value of when that property is shorthand
 * (`{ url }` or `{ url = '/' }`), else null.
 */
function shorthandProperty(p: Parsed, node: Node): TSESTreeProperty | null {
  let parent = parentOf(p, node);
  if (parent?.type === 'AssignmentPattern' && parent.left === node) parent = parentOf(p, parent);
  return parent?.type === 'Property' && parent.shorthand ? parent : null;
}

type TSESTreeProperty = Extract<Node, { type: 'Property' }>;

/**
 * Replaces an expression or binding identifier with new text, spelling out a
 * shorthand property first so its key stays the same: `{ url }` becomes
 * `{ url: next }`, not `{ next }`.
 */
export function replaceNode(p: Parsed, node: Node, text: string): Edit {
  const range = nameRange(node);
  const property = shorthandProperty(p, node);
  if (property !== null) return replaceRange(range, `${textOf(p, property.key)}: ${text}`);
  return replaceRange(range, text);
}

/**
 * The range of an identifier's name alone. typescript-estree stretches a
 * typed binding's range over its annotation (`req: Request`), which a rename
 * must keep.
 */
export function nameRange(node: Node): readonly [number, number] {
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return [node.range[0], node.range[0] + node.name.length];
  return node.range;
}

/** Renames one occurrence of an identifier, and the closing tag of a JSX element it names. */
export function renameOccurrence(p: Parsed, identifier: Node, name: string): Edit[] {
  const edits = [replaceNode(p, identifier, name)];
  const parent = parentOf(p, identifier);
  if (parent?.type === 'JSXOpeningElement' && parent.name === identifier) {
    const element = parentOf(p, parent);
    if (element?.type === 'JSXElement' && element.closingElement !== null) {
      edits.push(replaceRange(element.closingElement.name.range, name));
    }
  }
  return edits;
}
