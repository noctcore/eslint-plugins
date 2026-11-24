import type { IMetaRule, IViolation } from '@noctcore/harness';

import { isScalar, LineCounter, parseDocument, visit, type Document, type Scalar, type YAMLError } from 'yaml';

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

interface Malformed {
  readonly line: number;
  readonly kind: 'brace' | 'unclosed' | 'string' | 'grammar' | 'if-mixed' | 'if-newline' | 'if-padded' | 'if-tag' | 'yaml';
  /** The expression and what is wrong with it, for `grammar`; the parser's message, for `yaml`. */
  readonly detail?: string;
  /** For `unclosed` and `string`: a ` #` comment cut the plain scalar short, and with it the expression. */
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

/** Tags YAML itself resolves (`!!str`, `!!bool`); any other tag on an `if:` value is a typo for a negation. */
const CORE_TAG_PREFIX = 'tag:yaml.org,2002:';

/**
 * An `if:` value that carries a non-core YAML tag (an unquoted `if: !cancelled()`),
 * or a string value with text outside its `${{ }}` (so always true). Reads the
 * parsed value untrimmed, as GitHub does: a `|` or `>` block keeps a trailing
 * newline and a quoted value keeps its spaces, and either makes the value a
 * string. Only one `${{ }}` that is the whole value is a condition.
 */
function ifProblem(node: Scalar): Malformed['kind'] | null {
  if (node.tag !== undefined && !node.tag.startsWith(CORE_TAG_PREFIX)) return 'if-tag';
  if (typeof node.value !== 'string') return null;
  const value = node.value;
  const first = value.indexOf(OPENER);
  if (first === -1) return null;
  const { close } = scanExpression(value, first + OPENER_LENGTH);
  const end = close === -1 ? -1 : close + CLOSER.length;
  if (first === 0 && (end === -1 || end === value.length)) return null;
  const onlyWhitespaceOutside = end !== -1 && value.slice(0, first).trim() === '' && value.slice(end).trim() === '';
  if (!onlyWhitespaceOutside) return 'if-mixed';
  const block = node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED';
  return block && first === 0 ? 'if-newline' : 'if-padded';
}

/** The text GitHub reads from one scalar, with the source offset of each of its characters. */
interface ScalarText {
  readonly text: string;
  readonly offsetAt: (index: number) => number;
}

/** A run of source taken as is: plain and block scalars have no escapes. */
function sourceText(source: string, from: number, to: number): ScalarText {
  return { text: source.slice(from, to), offsetAt: (index) => from + index };
}

const DOUBLE_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1B',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xA0',
  L: '\u2028',
  P: '\u2029',
};
const HEX_ESCAPE_LENGTH: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };
const MAX_CODE_POINT = 0x10ffff;

/**
 * A quoted scalar's body read the way GitHub gets it: `''` is one quote in a
 * single-quoted scalar, and a double-quoted scalar's escapes are decoded (an
 * escaped line break joins the lines). Line breaks are kept rather than
 * folded into spaces: both are whitespace to an expression, and keeping them
 * keeps every character on its source line.
 */
function quotedText(source: string, from: number, to: number, double: boolean): ScalarText {
  let text = '';
  const offsets: number[] = [];
  const push = (chars: string, offset: number): void => {
    text += chars;
    for (let step = 0; step < chars.length; step += 1) offsets.push(offset);
  };
  for (let index = from; index < to; index += 1) {
    const char = source[index] ?? '';
    if (!double) {
      push(char, index);
      if (char === "'" && source[index + 1] === "'") index += 1;
      continue;
    }
    if (char !== '\\') {
      push(char, index);
      continue;
    }
    const escape = source[index + 1] ?? '';
    if (escape === '\n' || escape === '\r') {
      let next = index + 1;
      if (source[next] === '\r') next += 1;
      if (source[next] === '\n') next += 1;
      while (source[next] === ' ' || source[next] === '\t') next += 1;
      index = next - 1;
      continue;
    }
    const hexLength = HEX_ESCAPE_LENGTH[escape];
    const code = hexLength === undefined ? Number.NaN : Number.parseInt(source.slice(index + 2, index + 2 + hexLength), 16);
    if (hexLength !== undefined && code <= MAX_CODE_POINT) {
      push(String.fromCodePoint(code), index);
      index += 1 + hexLength;
    } else {
      push(DOUBLE_ESCAPES[escape] ?? escape, index);
      index += 1;
    }
  }
  return { text, offsetAt: (index) => offsets[index] ?? to };
}

/** The text of a scalar GitHub reads, or null for a node with no source range. */
function scalarText(source: string, node: Scalar): ScalarText | null {
  const range = node.range;
  if (range === null || range === undefined) return null;
  const [start, end] = range;
  switch (node.type) {
    case 'BLOCK_LITERAL':
    case 'BLOCK_FOLDED': {
      // The range starts at the `|` or `>` header, whose line (and its comment) is not content.
      const newline = source.indexOf('\n', start);
      return newline === -1 || newline >= end ? null : sourceText(source, newline + 1, end);
    }
    case 'QUOTE_SINGLE':
      return quotedText(source, start + 1, end - 1, false);
    case 'QUOTE_DOUBLE':
      return quotedText(source, start + 1, end - 1, true);
    default:
      return sourceText(source, start, end);
  }
}

/** A comment right after a plain scalar, on the scalar's last line. */
const COMMENT_AFTER = /[ \t]+#/uy;

/** Whether a ` #` comment cut the plain scalar `node` short where it ends. */
function endsAtComment(source: string, node: Scalar): boolean {
  const end = node.range?.[1];
  if (node.type !== 'PLAIN' || end === undefined) return false;
  COMMENT_AFTER.lastIndex = end;
  return COMMENT_AFTER.test(source);
}

/** Every malformed expression in one scalar's text. */
function malformedOpeners(
  { text, offsetAt }: ScalarText,
  cutAtEnd: boolean,
  lineOf: (offset: number) => number,
): Malformed[] {
  const lineAt = (index: number): number => lineOf(offsetAt(index));
  const found: Malformed[] = [];
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
      // Only an expression that runs to a scalar's end can have lost its rest to a comment.
      const cutByComment = cutAtEnd && next === -1;
      // A comment cut means GitHub never sees the rest of the expression: it is unclosed, whatever string it holds.
      found.push({ line: lineAt(opener), kind: inString && !cutByComment ? 'string' : 'unclosed', cutByComment });
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

/** The first YAML error in a workflow, as GitHub rejects a workflow it cannot parse. */
function yamlProblem(error: YAMLError, lineOf: (offset: number) => number): Malformed {
  const detail = error.code === 'MULTIPLE_DOCS' ? 'it holds more than one YAML document' : error.message;
  return { line: lineOf(error.pos[0]), kind: 'yaml', detail: detail.replace(/\.$/u, '') };
}

/** Every malformed expression and `if:` in one workflow's text. */
function malformedIn(source: string): Malformed[] {
  const counter = new LineCounter();
  const lineOf = (offset: number): number => counter.linePos(offset).line;
  let doc: Document.Parsed;
  try {
    doc = parseDocument(source, { lineCounter: counter, prettyErrors: false });
  } catch (thrown) {
    // The parser collects errors rather than throwing; this is a guard, so one odd file never stops the run.
    return [{ line: 1, kind: 'yaml', detail: thrown instanceof Error ? thrown.message : String(thrown) }];
  }
  const error = doc.errors[0];
  // A broken parse leaves a partial tree, so its scalars are not what GitHub would read.
  if (error !== undefined) return [yamlProblem(error, lineOf)];
  const found: Malformed[] = [];
  visit(doc, {
    Pair(_, pair) {
      if (!isScalar(pair.key) || pair.key.value !== 'if' || !isScalar(pair.value)) return;
      const kind = ifProblem(pair.value);
      if (kind !== null) found.push({ line: lineOf(pair.key.range?.[0] ?? 0), kind });
    },
    Scalar(_, node) {
      const scalar = scalarText(source, node);
      if (scalar !== null) found.push(...malformedOpeners(scalar, endsAtComment(source, node), lineOf));
    },
  });
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
    case 'if-newline':
      return `${at} \`if:\` is a \`|\` or \`>\` block, which keeps a trailing newline after its \`\${{ }}\`, so GitHub reads the value as a string, and a non-empty string is always true. Write \`|-\` or \`>-\`, which strip the newline.`;
    case 'if-padded':
      return `${at} \`if:\` keeps whitespace around its \`\${{ }}\` (spaces inside the quotes, or extra lines in a block), so GitHub reads the value as a string, and a non-empty string is always true. Remove the padding so the \`\${{ }}\` is the whole value.`;
    case 'if-tag':
      return `${at} \`if:\` starts with \`!\`, which YAML reads as a tag, not a negation. Quote the value or wrap it in \`\${{ }}\`.`;
    case 'yaml':
      return `${at} the workflow is not valid YAML: ${detail ?? ''}. ${REJECTS}`;
  }
}

/** Check one workflow's text. */
export function checkWorkflowExpressionSyntax(file: string, text: string): IViolation[] {
  return malformedIn(text).map(
    (malformed): IViolation => ({ file, rule: RULE_ID, line: malformed.line, message: messageFor(malformed) }),
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
