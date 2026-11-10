/*
 * A textual reader for the steps of a GitHub Actions workflow: every item of
 * every `steps:` list, and the keys written on each step. Line based, not a
 * YAML parse, like the other workflow rules in this package.
 */

/** One item of a `steps:` list, as 0-based line indexes `[start, end)`. */
export interface WorkflowStep {
  readonly start: number;
  readonly end: number;
  /** The step's `name:`, or where it starts when it has none. */
  readonly label: string;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/** Every step of every `steps:` list in the workflow. */
export function workflowSteps(lines: readonly string[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  lines.forEach((line, stepsIndex) => {
    if (!/^\s*steps:\s*$/u.test(line)) return;
    const listIndent = indentOf(line);
    let itemIndent = -1;
    let start = -1;
    const close = (end: number): void => {
      if (start === -1) return;
      const name = lines
        .slice(start, end)
        .map((candidate) => /^\s*(?:-\s+)?name:\s*(.+?)\s*$/u.exec(candidate)?.[1])
        .find((candidate) => candidate !== undefined);
      steps.push({ start, end, label: name ?? `the step on line ${String(start + 1)}` });
    };
    let end = stepsIndex + 1;
    for (let index = stepsIndex + 1; index < lines.length; index += 1) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || current.trimStart().startsWith('#')) continue;
      const indent = indentOf(current);
      const isItem = /^\s*-(?:\s|$)/u.test(current);
      // A sequence may sit at its key's own indent; anything else that shallow ends the list.
      if (indent < listIndent || (indent === listIndent && !isItem)) break;
      if (itemIndent === -1 && isItem) itemIndent = indent;
      if (isItem && indent === itemIndent) {
        close(index);
        start = index;
      }
      end = index + 1;
    }
    close(end);
  });
  return steps;
}

/** The column a step's own keys start at: just past the `- ` of its first line. */
function stepKeyColumn(lines: readonly string[], step: WorkflowStep): number {
  const first = lines[step.start] ?? '';
  return /^(\s*-\s+)/u.exec(first)?.[1]?.length ?? indentOf(first) + 2;
}

/**
 * The keys written on a step, each with its value lines: the inline value, or
 * the lines nested under the key (a `with:` mapping, a `run: |` block).
 */
export function stepKeys(lines: readonly string[], step: WorkflowStep): Map<string, readonly string[]> {
  const keyColumn = stepKeyColumn(lines, step);
  const keys = new Map<string, string[]>();
  let open: string[] | null = null;
  for (let index = step.start; index < step.end; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const indent = index === step.start ? keyColumn : indentOf(line);
    const text = index === step.start ? line.slice(keyColumn) : line.trimStart();
    if (indent > keyColumn) {
      open?.push(text.trimEnd());
      continue;
    }
    const key = /^([\w-]+):\s*(.*?)\s*$/u.exec(text);
    open = null;
    if (indent !== keyColumn || key === null) continue;
    const value = key[2] ?? '';
    // A block scalar header (`|`, `>-`, `|2+`) or nothing: the value is the lines under it.
    open = value === '' || /^[|>][+-]?\d*[+-]?$/u.test(value) ? [] : null;
    keys.set(key[1] ?? '', open ?? [value]);
  }
  return keys;
}
