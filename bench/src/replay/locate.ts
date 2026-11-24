/**
 * Where a fix happened, so a report can be tied to it or not.
 *
 * A real file has more than one sink, and most survive the fix untouched: a
 * client with forty configured endpoints, of which one took a user value.
 * Counting every report in the file would credit a rule for the other
 * thirty-nine before the fix and charge it for them after. So a report counts
 * only when it is **near the fix**: inside the innermost function that holds a
 * line the fix changed on that side (a module-level report: within
 * {@link MODULE_LEVEL_RADIUS} lines of one). A guard added at the top of a
 * function therefore ties the sink further down to the fix, while a sink in an
 * untouched function stays out of both sides.
 */
import { isFunctionNode, parseSource } from '../variants/ast';

/** How far a module-level report may sit from a changed line and still count. */
export const MODULE_LEVEL_RADIUS = 3;

/** Lines changed on each side, 1-based. An insertion also touches the old lines around it, and a deletion the new ones. */
export interface Touched {
  readonly before: ReadonlySet<number>;
  readonly after: ReadonlySet<number>;
}

/** Above this many cells the middle of the diff is taken as changed wholesale instead of aligned. */
const MAX_CELLS = 16_000_000;

/** A line diff: common prefix and suffix trimmed, the middle aligned by longest common subsequence. */
export function touchedLines(beforeText: string, afterText: string): Touched {
  const a = beforeText.split(/\r?\n/u);
  const b = afterText.split(/\r?\n/u);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const before = new Set<number>();
  const after = new Set<number>();
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return { before, after };

  // keep[i] / keepB[j]: whether a[start + i] / b[start + j] is part of the common subsequence.
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_CELLS) {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? (table[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        keepA[i++] = 1;
        keepB[j++] = 1;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++;
      else j++;
    }
  }
  // Walk both sides in step; each run of changes marks its own lines, and an
  // insertion or deletion with nothing opposite marks the neighbours opposite.
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && keepA[i] === 1 && keepB[j] === 1) {
      i++;
      j++;
      continue;
    }
    const fromI = i;
    const fromJ = j;
    while (i < n && keepA[i] !== 1) i++;
    while (j < m && keepB[j] !== 1) j++;
    for (let k = fromI; k < i; k++) before.add(start + k + 1);
    for (let k = fromJ; k < j; k++) after.add(start + k + 1);
    if (i === fromI) {
      before.add(start + fromI);
      before.add(start + fromI + 1);
    }
    if (j === fromJ) {
      after.add(start + fromJ);
      after.add(start + fromJ + 1);
    }
  }
  return { before, after };
}

/** The line spans of every function in a source, for {@link nearTouched}. */
export function functionSpans(source: string, lintPath: string): (readonly [number, number])[] {
  return parseSource(source, lintPath)
    .nodes.filter(isFunctionNode)
    .map((node) => [node.loc.start.line, node.loc.end.line] as const);
}

/** Whether a report on `line` is near a touched line: same innermost function, or close at module level. */
export function nearTouched(line: number, spans: readonly (readonly [number, number])[], touched: ReadonlySet<number>): boolean {
  let region: readonly [number, number] | null = null;
  for (const span of spans) {
    if (span[0] <= line && line <= span[1] && (region === null || span[1] - span[0] < region[1] - region[0])) region = span;
  }
  const [from, to] = region ?? [line - MODULE_LEVEL_RADIUS, line + MODULE_LEVEL_RADIUS];
  for (const t of touched) if (t >= from && t <= to) return true;
  return false;
}
