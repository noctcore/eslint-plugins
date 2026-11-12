import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles } from './shared';

/** Options for {@link createGithubActionsExpressionSyntaxRule}. */
export interface GithubActionsExpressionSyntaxOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-expression-syntax';

const OPENER = '${{';
const CLOSER = '}}';
const OPENER_LENGTH = OPENER.length;

/** Indent, an optional `- `, an optional `key:` and the rest of the line. */
const HEADER = /^(\s*)(-\s+)?(?:(?:"[^"]+"|'[^']+'|[\w.-]+):(?:\s+|$))?(.*)$/u;
const KEYED = /^\s*(?:-\s+)?(?:"[^"]+"|'[^']+'|[\w.-]+):(?:\s|$)/u;

interface Segment {
  /** 1-indexed line of the first line of the segment. */
  readonly startLine: number;
  readonly lines: readonly string[];
}

interface Malformed {
  readonly line: number;
  readonly kind: 'brace' | 'unclosed';
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/** The column a scalar's continuation lines must be indented past, or null when the line holds no scalar. */
function scalarKeyColumn(line: string): number | null {
  const match = HEADER.exec(line);
  if (match === null) return null;
  const indent = (match[1] ?? '').length;
  const dash = match[2];
  const rest = (match[3] ?? '').trim();
  if (rest === '' || rest.startsWith('#')) return null;
  const keyed = KEYED.test(line);
  return dash !== undefined && keyed ? indent + dash.length : indent;
}

/**
 * Group lines into the units GitHub lexes together: a scalar's header plus the
 * blank or deeper lines that continue it (block, plain and quoted scalars),
 * and every other line on its own. Comments are kept, because the lexer reads
 * a `${{` in a comment too.
 */
function scalarSegments(lines: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const column = scalarKeyColumn(line);
    let end = index + 1;
    if (column !== null) {
      while (end < lines.length) {
        const next = lines[end] ?? '';
        if (next.trim() !== '' && indentOf(next) <= column) break;
        end += 1;
      }
    }
    segments.push({ startLine: index + 1, lines: lines.slice(index, end) });
    index = end;
  }
  return segments;
}

/** Every opener in a segment that is followed by another `{` or never closed. */
function malformedOpeners(segment: Segment): Malformed[] {
  const text = segment.lines.join('\n');
  const lineAt = (offset: number): number =>
    segment.startLine + (text.slice(0, offset).match(/\n/gu)?.length ?? 0);
  const found: Malformed[] = [];

  let cursor = text.indexOf(OPENER);
  while (cursor !== -1) {
    const opener = cursor;
    if (text[opener + OPENER_LENGTH] === '{') {
      found.push({ line: lineAt(opener), kind: 'brace' });
      cursor = text.indexOf(OPENER, opener + OPENER_LENGTH);
      continue;
    }

    // Expression strings use single quotes only, with `''` as an escaped quote.
    let inString = false;
    let scan = opener + OPENER_LENGTH;
    let next = -1;
    let closed = false;
    while (scan < text.length) {
      if (inString) {
        if (text[scan] === "'") {
          if (text[scan + 1] === "'") scan += 1;
          else inString = false;
        }
        scan += 1;
        continue;
      }
      if (text[scan] === "'") {
        inString = true;
        scan += 1;
      } else if (text.startsWith(CLOSER, scan)) {
        closed = true;
        next = scan + CLOSER.length;
        break;
      } else if (text.startsWith(OPENER, scan)) {
        next = scan;
        break;
      } else {
        scan += 1;
      }
    }
    if (!closed) found.push({ line: lineAt(opener), kind: 'unclosed' });
    cursor = next === -1 ? -1 : text.indexOf(OPENER, next);
  }
  return found;
}

/** Check one workflow's text. */
export function checkWorkflowExpressionSyntax(file: string, text: string): IViolation[] {
  const consequence = 'GitHub rejects the whole workflow before any job runs, so its required checks never report.';
  return scalarSegments(text.split('\n')).flatMap((segment) =>
    malformedOpeners(segment).map(
      ({ line, kind }): IViolation => ({
        file,
        rule: RULE_ID,
        line,
        message:
          kind === 'brace'
            ? `line ${String(line)}: \`\${{{\` opens an expression with another \`{\`. ${consequence} Put a space after \`\${{\` if the brace belongs to the expression, or keep a literal \`\${{\` out of scripts and f-strings, for example by building it from pieces.`
            : `line ${String(line)}: \`\${{\` has no closing \`}}\` (on its line, or within its block scalar). ${consequence}`,
      }),
    ),
  );
}

/** A workflow must not hold a `${{` followed by another `{`, or one with no closing `}}`. */
export function createGithubActionsExpressionSyntaxRule(
  options: GithubActionsExpressionSyntaxOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions workflows never hold a malformed `${{` (an opener followed by another `{`, or one with no closing `}}`), which fails the whole workflow before any job runs.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowExpressionSyntax(file, ctx.read(file) ?? ''),
      );
    },
  };
}
