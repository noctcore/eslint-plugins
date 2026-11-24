/**
 * Finds the sink lines a value-flow transform rewrites around. A vulnerable
 * case names them with its labels; a safe twin has none, so each labelled
 * line of its vulnerable twin is matched to the safe line that looks and acts
 * most alike.
 */
import type { CorpusCase } from '../corpus';
import { parseSource, type Node, type Parsed } from './ast';
import { leavesOnLine } from './flow';

/**
 * What a line does, as far as finding the same sink goes: the callee it calls
 * (`res.redirect`, `cp.exec`), the target it assigns (`ctx.body=`), the
 * property it sets (`httpOnly:`), the element it opens (`<p`), or `return`.
 */
export function lineHead(line: string): string | null {
  const code = line.replace(/\/\/.*$|\/\*.*?\*\//gu, '').trim();
  const rest = code
    .replace(/^(?:const|let|var)\s+[^=]+=\s*/u, '')
    .replace(/^return\b\s*/u, '')
    .replace(/^await\s+/u, '');
  const head =
    /^([A-Za-z_$][\w$.]*)\s*\(/u.exec(rest)?.[1] ??
    /^([A-Za-z_$][\w$.]*\s*\+?=)(?!=)/u.exec(rest)?.[1]?.replace(/\s+/gu, '') ??
    /^([A-Za-z_$][\w$]*)\s*:/u.exec(rest)?.[1]?.concat(':') ??
    /^(<[A-Za-z][\w.]*)/u.exec(rest)?.[1];
  if (head !== undefined) return head;
  return /^return\b/u.test(code) ? 'return' : null;
}

function words(line: string): Set<string> {
  return new Set(line.replace(/\/\/.*$|\/\*.*?\*\//gu, '').match(/[A-Za-z_$][\w$]*/gu) ?? []);
}

function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const shared = [...a].filter((w) => b.has(w)).length;
  const all = new Set([...a, ...b]).size;
  return all === 0 ? 0 : shared / all;
}

/** How alike a safe line must be to a labelled line to count as the same sink. */
const SAME_SINK = 0.3;
/** What doing the same thing (the same callee, target, property or element) adds to a line's likeness. */
const SAME_HEAD = 0.5;
/** What reading a local value adds: `res.redirect(url.pathname)` over the guard's `return res.redirect('/')`. */
const READS_VALUE = 0.25;

/**
 * The lines that hold the sink. A vulnerable case's are its labelled lines; a
 * safe twin has no labels, so each labelled line of its vulnerable twin is
 * matched to the twin's most similar line: shared identifiers over all
 * identifiers, plus {@link SAME_HEAD} when the line does the same thing
 * ({@link lineHead}) and {@link READS_VALUE} when it reads a local value, at
 * least {@link SAME_SINK} in all. A safe twin that dropped the sink line falls
 * back to the first line that reads the same value.
 */
export function sinkLines(testCase: CorpusCase, vulnTwins: readonly CorpusCase[], parsed?: Parsed): number[] {
  if (testCase.kind === 'vuln') return [...new Set(testCase.expects.map((e) => e.line))];
  const p = parsed ?? parseSource(testCase.source, testCase.lintPath);
  const lines = testCase.source.split(/\r?\n/u).map((line, i) => ({
    words: words(line),
    head: lineHead(line),
    leaves: i === 0 ? [] : leavesOnLine(p, i + 1),
  }));
  const out = new Set<number>();
  for (const twin of vulnTwins) {
    const twinLines = twin.source.split(/\r?\n/u);
    let twinParsed: Parsed | null = null;
    for (const label of twin.expects) {
      const text = twinLines[label.line - 1] ?? '';
      const target = words(text);
      const head = lineHead(text);
      let best = -1;
      let bestScore = 0;
      // Line 1 is the header. On a tie the later line wins: a guard rejects early and the sink comes last.
      lines.forEach((line, i) => {
        if (i === 0) return;
        const alike = similarity(target, line.words) + (head !== null && head === line.head ? SAME_HEAD : 0);
        const score = alike + (alike > 0 && line.leaves.length > 0 ? READS_VALUE : 0);
        if (score > 0 && score >= bestScore) {
          best = i;
          bestScore = score;
        }
      });
      if (best !== -1 && bestScore >= SAME_SINK) {
        out.add(best + 1);
        continue;
      }
      // No line looks alike (the safe twin dropped the sink): take the first line that reads the same value.
      twinParsed ??= parseSource(twin.source, twin.lintPath);
      const values = new Set(leavesOnLine(twinParsed, label.line).map((l) => rootName(l.node)));
      const reader = lines.findIndex((line) => line.leaves.some((l) => values.has(rootName(l.node))));
      if (reader !== -1) out.add(reader + 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The identifier a leaf's property chain starts from: `req` for `req.query.next`. */
function rootName(node: Node): string | null {
  let cur: Node = node;
  while (cur.type === 'MemberExpression') cur = cur.object;
  return cur.type === 'Identifier' ? cur.name : null;
}
