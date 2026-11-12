/**
 * Pure text helpers shared by components, client scripts and the site tests.
 * Nothing here imports the generated catalog or reads `import.meta.env`, so the
 * tests under scripts/ can load it in CI, where no sync has run.
 */

/** `code-quality` -> `codeQuality`, the import name the snippets use. */
export function importName(short: string): string {
  return short.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** `1 rule`, `2 rules`: a count with its noun, singular when the count is one. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Rule descriptions use Markdown code spans. Split on the backtick: odd
 * segments are code. Shared by every table that renders a description.
 */
export function codeSpans(text: string): { part: string; code: boolean }[] {
  return text.split('`').map((part, i) => ({ part, code: i % 2 === 1 }));
}

/** The preset column's state: on in `recommended`, on in `strict` only, registered off, or left out. */
export function presetLabel(rule: {
  recommended: string | null;
  strict?: string | null;
}): 'error' | 'strict' | 'off' | 'not listed' {
  if (rule.recommended === 'error') return 'error';
  if (rule.strict === 'error') return 'strict';
  return rule.recommended === 'off' ? 'off' : 'not listed';
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
