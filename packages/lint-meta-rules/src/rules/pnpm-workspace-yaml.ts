import { stripYamlComment, unquote } from './shared';

/*
 * A textual reader for the shapes pnpm-workspace.yaml uses at its top level: a
 * `key: value` scalar, a `key:` block list of `- item` lines, and a `key:`
 * mapping of `name: value` lines. The supply-chain rules read it this way so
 * the package needs no YAML parser; anything else under a key is handed back
 * as unreadable, so a rule can report it instead of reading it as empty.
 */

/** One `- item` of a block list, with the comment lines written directly above it (or above the run of items it belongs to). */
export interface WorkspaceListItem {
  readonly value: string;
  /** The comment block above the item, joined into one line; '' when there is none. */
  readonly reason: string;
}

export interface WorkspaceList {
  readonly items: readonly WorkspaceListItem[];
  /** Lines under the key that are neither an item nor a comment, and a flow list written on the key's own line. */
  readonly unreadable: readonly string[];
}

/** The value of a top-level `key: value` line, unquoted and without its comment, or null when the key is not there. */
export function workspaceScalar(text: string, key: string): string | null {
  for (const line of text.split('\n')) {
    if (line.startsWith(`${key}:`)) return unquote(stripYamlComment(line.slice(key.length + 1)));
  }
  return null;
}

/** The lines indented under a top-level `key:`, or null when the key is not there. */
function blockUnder(text: string, key: string): { inline: string; lines: string[] } | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return null;
  const inline = stripYamlComment((lines[start] ?? '').slice(key.length + 1)).trim();
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    body.push(line);
  }
  return { inline, lines: body };
}

/** The `- item` lines of a top-level block list, or null when the key is not there. */
export function workspaceList(text: string, key: string): WorkspaceList | null {
  const block = blockUnder(text, key);
  if (block === null) return null;
  const items: WorkspaceListItem[] = [];
  const unreadable: string[] = block.inline === '' ? [] : [block.inline];
  let comment: string[] = [];
  let reason = '';
  for (const line of block.lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      comment = [];
      reason = '';
      continue;
    }
    if (trimmed.startsWith('#')) {
      comment.push(trimmed.replace(/^#\s?/u, ''));
      continue;
    }
    const item = /^-\s+(.*)$/u.exec(trimmed);
    if (item === null) {
      unreadable.push(trimmed);
      continue;
    }
    if (comment.length > 0) {
      reason = comment.join(' ');
      comment = [];
    }
    items.push({ value: unquote(stripYamlComment(item[1] ?? '')), reason });
  }
  return { items, unreadable };
}

/** The `name: value` lines of a top-level mapping (pnpm's `overrides:`), or null when the key is not there. */
export function workspaceMap(text: string, key: string): Map<string, string> | null {
  const block = blockUnder(text, key);
  if (block === null) return null;
  const out = new Map<string, string>();
  for (const line of block.lines) {
    const trimmed = stripYamlComment(line).trim();
    if (trimmed === '') continue;
    // A quoted key may hold a `:` of its own (`'tar@<7.5.22'` does not, but a URL could).
    const match = /^(?:'([^']+)'|"([^"]+)"|([^\s:'"][^:]*?))\s*:\s*(.+)$/u.exec(trimmed);
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    if (name !== undefined && match?.[4] !== undefined) out.set(name, unquote(match[4]));
  }
  return out;
}
