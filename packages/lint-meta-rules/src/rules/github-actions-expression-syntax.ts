import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  isMap,
  isScalar,
  isSeq,
  Lexer,
  LineCounter,
  parseDocument,
  visit,
  type Document,
  type Scalar,
  type YAMLError,
  type YAMLMap,
} from 'yaml';

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
  /** The expression and what is wrong with it, for `grammar`; what keeps GitHub from loading the workflow, for `yaml`. */
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

/**
 * A number literal. Every digit run is atomic (`(?=(\d+))\1` cannot give
 * digits back), so a long run is matched in linear time instead of being
 * split every possible way.
 */
const NUMBER =
  /0x(?=([\dA-Fa-f]+))\1|[-+]?(?:(?=(\d+))\2(?:\.(?=(\d*))\3)?|\.(?=(\d+))\4)(?:[eE][-+]?(?=(\d+))\5)?/u.source;
/**
 * The tokens of an expression body. A number glued to name characters
 * (`123abc`, `1-2`) is one token, so the scan moves past the whole run at
 * once; {@link NUMBER_TOKEN} then rejects it as not a number.
 */
const TOKEN = new RegExp(
  `\\s+|'(?:[^']|'')*'|(?:${NUMBER})(?![\\w-])|\\d[\\w-]*|[A-Za-z_][\\w-]*|==|!=|<=|>=|&&|\\|\\||[\\s\\S]`,
  'gu',
);
const NUMBER_TOKEN = new RegExp(`^(?:${NUMBER})$`, 'u');
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
    } else if (token.startsWith("'") || IDENT.test(token) || NUMBER_TOKEN.test(token)) {
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

/** The first YAML error left after {@link readWorkflow}: GitHub cannot load such a workflow either. */
function yamlProblem(error: YAMLError, lineOf: (offset: number) => number): Malformed {
  const detail =
    error.code === 'MULTIPLE_DOCS'
      ? 'the workflow holds more than one YAML document'
      : `the workflow is not valid YAML: ${error.message.replace(/\.$/u, '')}`;
  return { line: lineOf(error.pos[0]), kind: 'yaml', detail };
}

/** Lexer tokens that are markers, not source text: document start, flow error end, scalar. */
const FLOW_ERROR_END = '\x18';
const MARKER_TOKENS = new Set(['\x02', FLOW_ERROR_END, '\x1F']);
const COMPLETE_QUOTED: Readonly<Record<string, RegExp>> = {
  '"': /^"(?:[^"\\]|\\[\s\S])*"$/u,
  "'": /^'(?:[^']|'')*'$/u,
};
/** Each repair indents one line or spaces one comment, so this bounds the work on a broken file. */
const MAX_REPAIRS = 200;

/** `text` with the line at `offset` indented to at least `indent` columns, or null when it already is. */
function indentLineTo(text: string, offset: number, indent: number): string | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const current = /^ */u.exec(text.slice(lineStart))?.[0].length ?? 0;
  if (current >= indent) return null;
  return `${text.slice(0, lineStart)}${' '.repeat(indent - current)}${text.slice(lineStart)}`;
}

/**
 * `text` with the first under-indented continuation of a flow collection or a
 * quoted scalar indented past its opener, or null when there is none. GitHub's
 * reader only needs such a line to stay inside its `[`, `{` or quote; yaml
 * also wants it indented past the parent key, and ends the collection or
 * scalar early otherwise. Extra indentation there is folded away, so neither
 * the parsed values nor any line number change. A collection or quote still
 * open at the end of the file is left alone: it is really unclosed.
 */
function indentContinuation(text: string): string | null {
  const openers: number[] = [];
  let quoteColumn: number | null = null;
  let offset = 0;
  for (const token of new Lexer().lex(text)) {
    if (MARKER_TOKENS.has(token)) {
      if (token === FLOW_ERROR_END && openers.length > 0 && text.slice(offset).trim() !== '') {
        return indentLineTo(text, offset, (openers[0] ?? 0) + 1);
      }
      if (token === FLOW_ERROR_END) openers.length = 0;
      continue;
    }
    const column = offset - (text.lastIndexOf('\n', offset - 1) + 1);
    if (quoteColumn !== null && token.trim() !== '') return indentLineTo(text, offset, quoteColumn + 1);
    if (token === '[' || token === '{') openers.push(column);
    else if (token === ']' || token === '}') openers.pop();
    const pattern = COMPLETE_QUOTED[token[0] ?? ''];
    if (pattern !== undefined && !pattern.test(token)) quoteColumn = column;
    offset += token.length;
  }
  return null;
}

/** One repair of a shape GitHub's reader accepts and yaml rejects, or null when none applies. */
function repairOnce(text: string, errors: readonly YAMLError[]): string | null {
  const indented = indentContinuation(text);
  if (indented !== null) return indented;
  // `[x,#c`: GitHub's reader takes a `#` right after a flow indicator as a comment.
  const comment = errors.find((error) => error.code === 'MISSING_CHAR' && error.message.startsWith('Comments must'));
  if (comment === undefined) return null;
  return `${text.slice(0, comment.pos[0])} ${text.slice(comment.pos[0])}`;
}

interface ReadWorkflow {
  readonly doc: Document.Parsed;
  /** The text the document was parsed from: the source, or a repair of it with the same lines. */
  readonly text: string;
  readonly lineOf: (offset: number) => number;
}

/**
 * Parse a workflow as close as yaml gets to GitHub's reader: not strict (a
 * `|# note` header, `"x"#c`, long or multi-line implicit keys are accepted),
 * duplicate keys left to {@link duplicateKeys}, and the indentation that only
 * yaml rejects repaired first (see {@link indentContinuation}).
 */
function readWorkflow(source: string): ReadWorkflow {
  let text = source;
  for (let round = 0; ; round += 1) {
    const counter = new LineCounter();
    const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, strict: false, uniqueKeys: false });
    const repaired = doc.errors.length === 0 || round === MAX_REPAIRS ? null : repairOnce(text, doc.errors);
    if (repaired === null) return { doc, text, lineOf: (offset) => counter.linePos(offset).line };
    text = repaired;
  }
}

/** Keys that repeat another key of their mapping. GitHub compares keys without case, so `On` repeats `on`. */
function duplicateKeys(map: YAMLMap, lineOf: (offset: number) => number): Malformed[] {
  const seen = new Map<string, Scalar>();
  const found: Malformed[] = [];
  for (const { key } of map.items) {
    if (!isScalar(key)) continue;
    const name = String(key.value).toLowerCase();
    const first = seen.get(name);
    if (first === undefined) {
      seen.set(name, key);
      continue;
    }
    const where = `line ${String(lineOf(first.range?.[0] ?? 0))}`;
    found.push({
      line: lineOf(key.range?.[0] ?? 0),
      kind: 'yaml',
      detail: `the key \`${String(key.value)}\` repeats \`${String(first.value)}\` from ${where}, and GitHub compares keys without case`,
    });
  }
  return found;
}

/** The `if:` keys GitHub evaluates as conditions, with their scalar values: `jobs.<id>.if` and `jobs.<id>.steps[*].if`. */
function conditions(doc: Document.Parsed): { key: Scalar; value: Scalar }[] {
  const jobs = doc.get('jobs', true);
  if (!isMap(jobs)) return [];
  return jobs.items.flatMap(({ value: job }) => {
    if (!isMap(job)) return [];
    const steps = job.get('steps', true);
    const owners = [job, ...(isSeq(steps) ? steps.items.filter(isMap) : [])];
    return owners.flatMap((owner) =>
      owner.items.flatMap(({ key, value }) =>
        isScalar(key) && key.value === 'if' && isScalar(value) ? [{ key, value }] : [],
      ),
    );
  });
}

/** Every malformed expression and `if:` in one workflow's text. */
function malformedIn(source: string): Malformed[] {
  let read: ReadWorkflow;
  try {
    read = readWorkflow(source);
  } catch (thrown) {
    // The parser collects errors rather than throwing; this is a guard, so one odd file never stops the run.
    const detail = `the workflow could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
    return [{ line: 1, kind: 'yaml', detail }];
  }
  const { doc, text, lineOf } = read;
  const error = doc.errors[0];
  // A broken parse leaves a partial tree, so its scalars are not what GitHub would read.
  if (error !== undefined) return [yamlProblem(error, lineOf)];
  const found: Malformed[] = conditions(doc).flatMap(({ key, value }) => {
    const kind = ifProblem(value);
    return kind === null ? [] : [{ line: lineOf(key.range?.[0] ?? 0), kind }];
  });
  visit(doc, {
    Map(_, map) {
      found.push(...duplicateKeys(map, lineOf));
    },
    Scalar(_, node) {
      const scalar = scalarText(text, node);
      if (scalar !== null) found.push(...malformedOpeners(scalar, endsAtComment(text, node), lineOf));
    },
  });
  return found;
}

const REJECTS = 'GitHub rejects the whole workflow before any job runs, so its required checks never report.';

const LOAD_FAILS = 'GitHub fails to load a workflow like this, so none of its jobs run.';

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
      return `${at} ${detail ?? ''}. ${LOAD_FAILS}`;
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
