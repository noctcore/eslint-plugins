import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, unquote } from './shared';

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
  readonly kind: 'brace' | 'unclosed' | 'string' | 'grammar' | 'if-mixed' | 'if-tag';
  /** The expression and what is wrong with it, for `grammar`. */
  readonly detail?: string;
  /** For `unclosed` and `string`: a YAML comment cut the rest of a line off the expression. */
  readonly cutByComment?: boolean;
}

interface Scan {
  /** Offset of the closing `}}`, or -1. */
  readonly close: number;
  /** Offset of a `${{` met before any `}}`, or -1. */
  readonly next: number;
  /** The scan ran off the end inside a string. */
  readonly inString: boolean;
}

/** Scan an expression body from `from` for its `}}`. Strings use single quotes only, with `''` as an escaped quote. */
function scanExpression(text: string, from: number): Scan {
  let inString = false;
  for (let scan = from; scan < text.length; scan += 1) {
    if (inString) {
      if (text[scan] === "'") {
        if (text[scan + 1] === "'") scan += 1;
        else inString = false;
      }
    } else if (text[scan] === "'") {
      inString = true;
    } else if (text.startsWith(CLOSER, scan)) {
      return { close: scan, next: -1, inString };
    } else if (text.startsWith(OPENER, scan)) {
      return { close: -1, next: scan, inString };
    }
  }
  return { close: -1, next: -1, inString };
}

const TOKEN =
  /\s+|'(?:[^']|'')*'|(?:0x[\dA-Fa-f]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?![\w-])|[A-Za-z_][\w-]*|==|!=|<=|>=|&&|\|\||[\s\S]/gu;
const BINARY = new Set(['==', '!=', '<', '<=', '>', '>=', '&&', '||']);
const NOT_OPERATORS: Readonly<Record<string, string>> = { '=': '==', '&': '&&', '|': '||' };
const IDENT = /^[A-Za-z_]/u;

/** What is wrong when an operand was expected after `prev` and `next` came instead. */
function missingOperand(prev: string, next = ''): string {
  if (BINARY.has(prev)) return `has \`${prev}\` with no right operand`;
  if (prev === '!') return 'has `!` with no operand';
  if (prev === ',') return 'has an empty argument after `,`';
  return `has an empty \`${prev}${next}\``;
}

/**
 * The first grammar problem in a closed expression body, or null. A token walk
 * that tracks whether an operand or an operator comes next, plus a bracket
 * stack; it checks shape, not names (an unknown function or context passes).
 * GitHub has no minus operator, so `-` belongs to names (`needs.build-job`).
 */
function grammarProblem(body: string): string | null {
  if (body.trim() === '') return 'is empty';
  const stack: ('(' | 'call' | '[')[] = [];
  let wantOperand = true;
  let afterDot = false;
  let prev = '';
  for (const [token] of body.matchAll(TOKEN)) {
    if (/^\s/u.test(token)) continue;
    if (afterDot) {
      if (!IDENT.test(token) && token !== '*') return 'has `.` with no property name after it';
      afterDot = false;
    } else if (token === '.') {
      if (wantOperand) return 'has `.` with nothing before it';
      afterDot = true;
    } else if (token.startsWith("'") || IDENT.test(token) || /^[-+]?\.?\d/u.test(token)) {
      if (!wantOperand) return `needs an operator between \`${prev}\` and \`${token}\``;
      wantOperand = false;
    } else if (token === '!') {
      if (!wantOperand) return `needs an operator between \`${prev}\` and \`!\``;
    } else if (token === '(') {
      if (wantOperand) stack.push('(');
      else if (IDENT.test(prev)) stack.push('call');
      else return `needs an operator between \`${prev}\` and \`(\``;
      wantOperand = true;
    } else if (token === '[') {
      if (wantOperand) return 'has `[` with nothing before it to index';
      stack.push('[');
      wantOperand = true;
    } else if (token === '*') {
      if (prev !== '[') return 'uses `*`, which is not an operator';
      wantOperand = false;
    } else if (token === ')' || token === ']') {
      const open = stack.pop();
      const matches = token === ']' ? open === '[' : open === '(' || open === 'call';
      if (!matches) {
        return open === undefined
          ? `has unbalanced brackets: \`${token}\` closes nothing`
          : `has unbalanced brackets: \`${token}\` closes a \`${open === '[' ? '[' : '('}\``;
      }
      if (wantOperand && !(open === 'call' && prev === '(')) return missingOperand(prev, token);
      wantOperand = false;
    } else if (token === ',') {
      if (stack.at(-1) !== 'call') return 'uses `,` outside the arguments of a function call';
      if (wantOperand) return missingOperand(prev);
      wantOperand = true;
    } else if (BINARY.has(token)) {
      if (wantOperand) {
        return BINARY.has(prev) || prev === '!' ? missingOperand(prev) : `has \`${token}\` with no left operand`;
      }
      wantOperand = true;
    } else {
      const meant = NOT_OPERATORS[token];
      return meant === undefined
        ? `holds \`${token}\`, which is not valid in an expression`
        : `uses \`${token}\`, which is not an operator (did you mean \`${meant}\`?)`;
    }
    prev = token;
  }
  if (afterDot) return 'has `.` with no property name after it';
  const open = stack.at(-1);
  if (open !== undefined) return `has unbalanced brackets: \`${open === '[' ? '[' : '('}\` is never closed`;
  return wantOperand ? missingOperand(prev) : null;
}

const IF_KEY = /^\s*(?:-\s+)?if:[ \t]+(.+)$/u;

/**
 * A single-line `if:` value that starts with `!` (a YAML tag), or that mixes a
 * `${{ }}` with other text (a string, so always true).
 * ponytail: single-line values only; a block or wrapped `if:` is not checked for mixing.
 */
function ifProblem(line: string): Malformed['kind'] | null {
  const raw = IF_KEY.exec(line)?.[1];
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value.startsWith('!')) return 'if-tag';
  const unquoted = value.startsWith("'") ? unquote(value).replaceAll("''", "'") : unquote(value);
  const first = unquoted.indexOf(OPENER);
  if (first === -1) return null;
  if (first !== 0) return 'if-mixed';
  const { close } = scanExpression(unquoted, OPENER_LENGTH);
  return close !== -1 && close + CLOSER.length !== unquoted.length ? 'if-mixed' : null;
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
 * The key column of a `key:` line with no inline value whose first following
 * non-blank line is a plain scalar (not a key, a list item or a comment), or
 * null. The scalar then belongs to the key, as in `if:` over `${{ a &&`.
 */
function valueOnNextLineColumn(lines: readonly string[], index: number): number | null {
  const line = lines[index] ?? '';
  if (!KEYED.test(line)) return null;
  const column = /^\s*-\s+/u.exec(line)?.[0].length ?? indentOf(line);
  const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
  if (next === undefined || indentOf(next) <= column) return null;
  const trimmed = next.trim();
  if (trimmed.startsWith('-') || trimmed.startsWith('#') || KEYED.test(next)) return null;
  return column;
}

type Lexed = 'node' | 'plain' | 'after';

/** Where a YAML comment starts on `line`, carrying an open quoted scalar across lines in `quote`. */
interface CommentScan {
  /** Offset of the `#` that starts a comment, or -1. */
  readonly comment: number;
  /** The quote of a quoted scalar still open at the end of the line, or null. */
  readonly quote: "'" | '"' | null;
  /** The line opens a block scalar (`|` or `>` where a value starts). */
  readonly block: boolean;
}

/**
 * Find the comment on one line outside block scalars. A `#` starts a comment
 * at the start of the line or after whitespace, never inside a single- or
 * double-quoted scalar. A quote only opens a quoted scalar where a value
 * starts; in a plain scalar it is text, so `if: ${{ x == 'a #b' }}` has a
 * comment from ` #`.
 */
function scanComment(line: string, open: "'" | '"' | null): CommentScan {
  let quote = open;
  let state: Lexed = quote === null ? 'node' : 'after';
  let flow = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote === "'") {
      if (char === "'") {
        if (line[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '\\') index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    const spaced = index === 0 || /\s/u.test(line[index - 1] ?? '');
    if (char === '#' && spaced) return { comment: index, quote: null, block: false };
    if (/\s/u.test(char)) continue;
    const ends = (line[index + 1] ?? ' ').trim() === '';
    if (char === ':' && ends && state !== 'node') {
      state = 'node';
    } else if (flow > 0 && (char === ',' || char === ']' || char === '}')) {
      if (char !== ',') flow -= 1;
      state = char === ',' ? 'node' : 'after';
    } else if (state !== 'node') {
      state = state === 'after' ? 'plain' : state;
    } else if (char === "'" || char === '"') {
      quote = char;
      state = 'after';
    } else if (char === '[' || char === '{') {
      flow += 1;
    } else if (char === '-' && ends) {
      // A list item: a node still comes next.
    } else if ((char === '|' || char === '>') && flow === 0) {
      const rest = line.slice(index + 1);
      const header = /^[-+\d]*(?=\s|$)/u.exec(rest);
      if (header !== null) {
        const after = index + 1 + header[0].length;
        const hash = line.indexOf('#', after);
        const comment = hash !== -1 && /^\s*$/u.test(line.slice(after, hash)) && hash > after ? hash : -1;
        return { comment, quote: null, block: true };
      }
      state = 'plain';
    } else {
      state = 'plain';
    }
  }
  return { comment: -1, quote, block: false };
}

/**
 * The workflow's lines with every YAML comment cut off: whole-line comments
 * and trailing ` #` comments, outside quoted scalars. GitHub parses the YAML
 * first and drops comments, so a `${{` in one is never read. A block scalar
 * (`|`, `>`) keeps its `#` text: that is literal text GitHub evaluates.
 */
function withoutYamlComments(lines: readonly string[]): { lines: string[]; cut: Set<number> } {
  const kept: string[] = [];
  const cut = new Set<number>();
  let quote: "'" | '"' | null = null;
  let blockColumn: number | null = null;
  for (const line of lines) {
    if (blockColumn !== null && (line.trim() === '' || indentOf(line) > blockColumn)) {
      kept.push(line);
      continue;
    }
    blockColumn = null;
    const scan = scanComment(line, quote);
    quote = scan.quote;
    if (scan.comment === -1) {
      kept.push(line);
    } else {
      cut.add(kept.length + 1);
      kept.push(line.slice(0, scan.comment).trimEnd());
    }
    if (scan.block) blockColumn = scalarKeyColumn(line) ?? indentOf(line);
  }
  return { lines: kept, cut };
}

/**
 * Group lines into the units GitHub lexes together: a scalar's header plus the
 * blank or deeper lines that continue it (block, plain and quoted scalars),
 * and every other line on its own. Comments are already gone (see
 * {@link withoutYamlComments}), because GitHub parses the YAML first and never
 * sees them.
 */
function scalarSegments(lines: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const column = scalarKeyColumn(line) ?? valueOnNextLineColumn(lines, index);
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

/** Every malformed expression in a segment, and a malformed `if:` on its first line. */
function malformedOpeners(segment: Segment, cut: ReadonlySet<number>): Malformed[] {
  const joined = segment.lines.join('\n');
  // A single-quoted YAML scalar writes a quote as `''`; GitHub sees one quote. No newline moves, so lines stay put.
  const singleQuoted = (HEADER.exec(segment.lines[0] ?? '')?.[3] ?? '').startsWith("'");
  const text = singleQuoted ? joined.replaceAll("''", "'") : joined;
  const lineAt = (offset: number): number =>
    segment.startLine + (text.slice(0, offset).match(/\n/gu)?.length ?? 0);
  const found: Malformed[] = [];
  const ifKind = ifProblem(segment.lines[0] ?? '');
  if (ifKind !== null) found.push({ line: segment.startLine, kind: ifKind });

  let cursor = text.indexOf(OPENER);
  while (cursor !== -1) {
    const opener = cursor;
    if (text[opener + OPENER_LENGTH] === '{') {
      found.push({ line: lineAt(opener), kind: 'brace' });
      cursor = text.indexOf(OPENER, opener + OPENER_LENGTH);
      continue;
    }
    const { close, next, inString } = scanExpression(text, opener + OPENER_LENGTH);
    if (close === -1) {
      const line = lineAt(opener);
      const last = next === -1 ? segment.startLine + segment.lines.length - 1 : lineAt(next);
      const cutByComment = Array.from({ length: last - line + 1 }, (_, step) => line + step).some((at) => cut.has(at));
      // A comment cut means GitHub never sees the rest of the expression: it is unclosed, whatever string it holds.
      found.push({ line, kind: inString && !cutByComment ? 'string' : 'unclosed', cutByComment });
      cursor = next;
      continue;
    }
    const body = text.slice(opener + OPENER_LENGTH, close);
    const problem = grammarProblem(body);
    if (problem !== null) {
      const shown = `\${{ ${body.trim().replace(/\s+/gu, ' ')} }}`.replace('{{  }}', '{{ }}');
      found.push({ line: lineAt(opener), kind: 'grammar', detail: `\`${shown}\` ${problem}` });
    }
    cursor = text.indexOf(OPENER, close + CLOSER.length);
  }
  return found;
}

const REJECTS = 'GitHub rejects the whole workflow before any job runs, so its required checks never report.';

const COMMENT_CUT =
  ' In a plain YAML value, ` #` starts a comment, so the rest of the line never reaches GitHub. Quote the value to keep the `#`.';

function messageFor({ line, kind, detail, cutByComment }: Malformed): string {
  const at = `line ${String(line)}:`;
  switch (kind) {
    case 'brace':
      return `${at} \`\${{{\` opens an expression with another \`{\`. ${REJECTS} Put a space after \`\${{\` if the brace belongs to the expression, or keep a literal \`\${{\` out of scripts and f-strings, for example by building it from pieces.`;
    case 'unclosed':
      return `${at} \`\${{\` has no closing \`}}\` (on its line, or within its block scalar). ${REJECTS}${cutByComment === true ? COMMENT_CUT : ''}`;
    case 'string':
      return `${at} a string inside \`\${{\` is never closed, so every \`}}\` after it is string text and the expression never ends. ${REJECTS}`;
    case 'grammar':
      return `${at} ${detail ?? ''}. ${REJECTS}`;
    case 'if-mixed':
      return `${at} \`if:\` mixes a \`\${{ }}\` with other text, so GitHub reads the value as a string, and a non-empty string is always true. Put the whole condition inside one \`\${{ }}\`, or drop the \`\${{ }}\`.`;
    case 'if-tag':
      return `${at} \`if:\` starts with \`!\`, which YAML reads as a tag, not a negation. Quote the value or wrap it in \`\${{ }}\`.`;
  }
}

/** Check one workflow's text. */
export function checkWorkflowExpressionSyntax(file: string, text: string): IViolation[] {
  const { lines, cut } = withoutYamlComments(text.split(/\r?\n/u));
  return scalarSegments(lines).flatMap((segment) =>
    malformedOpeners(segment, cut).map(
      (malformed): IViolation => ({ file, rule: RULE_ID, line: malformed.line, message: messageFor(malformed) }),
    ),
  );
}

/** A workflow must not hold a malformed `${{ }}` expression, or an `if:` that is always true or read as a YAML tag. */
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
      'GitHub Actions workflows never hold a malformed `${{` (an opener followed by another `{`, one with no closing `}}`, or an expression GitHub cannot parse), which fails the whole workflow before any job runs, nor an `if:` that is always true or read as a YAML tag.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowExpressionSyntax(file, ctx.read(file) ?? ''),
      );
    },
  };
}
