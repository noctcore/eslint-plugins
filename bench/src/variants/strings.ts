/**
 * String-building rewrites: a template literal, a `+` chain, `.concat()` and
 * `[...].join('')` build the same string. Every untagged template with a
 * substitution and every `+` chain that starts as string concatenation is
 * rewritten into the target form; nothing else changes.
 *
 * A template's lines stay lines (`'<p>\n' +` then the next piece on the next
 * line), so a multi-line HTML template keeps its shape. A `+` chain becomes
 * one line. Pieces that contain a comment are left alone, so no label moves.
 *
 * A join renders `null` and `undefined` differently from the other forms, so
 * it rewrites only strings whose every piece is provably a string. Template,
 * `+` and `.concat()` differ only for an object with its own `valueOf` or
 * `Symbol.toPrimitive` (`+` asks for the default primitive, the others for a
 * string), which request data never is, so those apply everywhere.
 */
import type { TSESTree } from '@typescript-eslint/utils';

import { hasCommentIn, parentOf, textOf, type Node, type Parsed } from './ast';
import { replaceRange, type Edit } from './edits';
import type { Transform } from './transform';

type Form = 'template' | 'concat' | 'concat-method' | 'join';

/** One piece of a built string: literal text (as a quoted literal) or an expression. */
type Piece =
  | { readonly kind: 'text'; readonly literal: string; readonly value: string; readonly breakAfter: boolean }
  | { readonly kind: 'expr'; readonly node: Node };

/** Expressions that need no parentheses as an operand of `+`. */
const TIGHT = new Set([
  'Identifier', 'MemberExpression', 'CallExpression', 'Literal', 'TemplateLiteral', 'ThisExpression', 'NewExpression',
  'ChainExpression', 'TSNonNullExpression', 'ArrayExpression', 'TaggedTemplateExpression',
]);

/** Parents in which a `+` chain needs no parentheses. */
const LOOSE_PARENTS = new Set([
  'VariableDeclarator', 'AssignmentExpression', 'ReturnStatement', 'ArrayExpression', 'JSXExpressionContainer',
  'TemplateLiteral', 'ExpressionStatement', 'ArrowFunctionExpression', 'SpreadElement', 'AssignmentPattern',
  'PropertyDefinition',
]);

function isStringLiteral(node: Node): boolean {
  return (node.type === 'Literal' && typeof node.value === 'string') || (node.type === 'TemplateLiteral' && node.expressions.length === 0);
}

/**
 * The raw text of a template chunk as the body of a single-quoted string, cut
 * at each real line break. Escapes mean the same in both, except `` \` `` and
 * `\$`, which a quoted string spells `` ` `` and `$`.
 */
function quoteTemplateRaw(raw: string): string[] {
  const lines: string[] = [];
  let body = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] ?? '';
    if (c === '\\') {
      const next = raw[i + 1] ?? '';
      body += next === '`' || next === '$' ? next : `\\${next}`;
      i++;
    } else if (c === "'") {
      body += "\\'";
    } else if (c === '\r' && raw[i + 1] === '\n') {
      continue;
    } else if (c === '\n') {
      lines.push(`${body}\\n`);
      body = '';
    } else {
      body += c;
    }
  }
  lines.push(body);
  return lines;
}

function templatePieces(template: TSESTree.TemplateLiteral): Piece[] {
  const pieces: Piece[] = [];
  template.quasis.forEach((quasi, i) => {
    const lines = quoteTemplateRaw(quasi.value.raw);
    lines.forEach((body, j) => {
      const last = j === lines.length - 1;
      if (body !== '') pieces.push({ kind: 'text', literal: `'${body}'`, value: '', breakAfter: !last });
    });
    const expression = template.expressions[i];
    if (expression !== undefined) pieces.push({ kind: 'expr', node: expression });
  });
  return pieces;
}

/** The operands of a left-leaning `+` chain, leftmost first. */
function chainOperands(chain: TSESTree.BinaryExpression): Node[] {
  const operands: Node[] = [];
  let node: Node = chain;
  while (node.type === 'BinaryExpression' && node.operator === '+') {
    operands.unshift(node.right);
    node = node.left;
  }
  operands.unshift(node);
  return operands;
}

function chainPieces(p: Parsed, operands: readonly Node[]): Piece[] {
  return operands.map((node): Piece => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      return { kind: 'text', literal: textOf(p, node), value: node.value, breakAfter: false };
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return { kind: 'text', literal: `'${quoteTemplateRaw(node.quasis[0]?.value.raw ?? '').join('')}'`, value: node.quasis[0]?.value.cooked ?? '', breakAfter: false };
    }
    return { kind: 'expr', node };
  });
}

function escapeForTemplate(value: string): string {
  return JSON.stringify(value)
    .slice(1, -1)
    .replace(/\\"/gu, '"')
    .replace(/`/gu, '\\`')
    .replace(/\$\{/gu, '\\${');
}

function wrap(p: Parsed, node: Node, tight: boolean): string {
  const text = textOf(p, node);
  if (node.type === 'SequenceExpression' || (tight && !TIGHT.has(node.type))) return `(${text})`;
  return text;
}

function emit(p: Parsed, pieces: readonly Piece[], form: Form): string {
  if (form === 'template') {
    const body = pieces.map((piece) => (piece.kind === 'text' ? escapeForTemplate(piece.value) : `\${${textOf(p, piece.node)}}`));
    return `\`${body.join('')}\``;
  }
  const parts = pieces.map((piece) => ({
    text: piece.kind === 'text' ? piece.literal : wrap(p, piece.node, form === 'concat'),
    breakAfter: piece.kind === 'text' && piece.breakAfter,
  }));
  // Starting from a string keeps `a + b + 'c'` from adding numbers before concatenating.
  if (pieces[0]?.kind !== 'text') parts.unshift({ text: "''", breakAfter: false });
  const joined = (items: typeof parts, separator: string): string =>
    items.map((item, i) => (i === items.length - 1 ? item.text : `${item.text}${separator.trimEnd()}${item.breakAfter ? '\n' : ' '}`)).join('');
  if (form === 'concat') return joined(parts, ' + ');
  if (form === 'join') return `[${joined(parts, ', ')}].join('')`;
  const [first, ...rest] = parts;
  return `${first?.text ?? "''"}.concat(${first?.breakAfter === true ? '\n' : ''}${joined(rest, ', ')})`;
}

/** The outermost string-building expressions of the file, of the given source forms. */
function targets(p: Parsed, from: ReadonlySet<'template' | 'chain'>): Node[] {
  const out: Node[] = [];
  for (const node of p.nodes) {
    if (out.some((o) => node.range[0] >= o.range[0] && node.range[1] <= o.range[1])) continue;
    if (hasCommentIn(p, node.range)) continue;
    const parent = parentOf(p, node);
    if (from.has('template') && node.type === 'TemplateLiteral' && node.expressions.length > 0 && parent?.type !== 'TaggedTemplateExpression') {
      out.push(node);
    } else if (from.has('chain') && node.type === 'BinaryExpression' && node.operator === '+') {
      if (parent?.type === 'BinaryExpression' && parent.operator === '+' && parent.left === node) continue;
      const operands = chainOperands(node);
      const [a, b] = operands;
      if ((a !== undefined && isStringLiteral(a)) || (b !== undefined && isStringLiteral(b))) out.push(node);
    }
  }
  return out;
}

function piecesOf(p: Parsed, node: Node): Piece[] {
  return node.type === 'TemplateLiteral' ? templatePieces(node) : chainPieces(p, chainOperands(node as TSESTree.BinaryExpression));
}

/** Globals that always return a string, when the file does not bind the name itself. */
const STRING_RESULT_GLOBALS = new Set(['String', 'encodeURIComponent', 'encodeURI']);

/**
 * Whether the expression is a string whatever it reads, judged from the code
 * alone: a string or template literal, `typeof`, a `+` with a string operand,
 * `String(...)` and the URI encoders, or a `const` initialised with one of
 * those. A type annotation proves nothing here: request data typed `string`
 * is `undefined` when the field is absent.
 */
function isProvablyString(p: Parsed, node: Node, depth = 0): boolean {
  if (depth > 8) return false;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral':
      return true;
    case 'UnaryExpression':
      return node.operator === 'typeof';
    case 'BinaryExpression':
      return node.operator === '+' && (isProvablyString(p, node.left, depth + 1) || isProvablyString(p, node.right, depth + 1));
    case 'CallExpression': {
      if (node.optional || node.callee.type !== 'Identifier' || !STRING_RESULT_GLOBALS.has(node.callee.name)) return false;
      // Unresolved, or the parser's own lib declaration of the global: the file does not bind it.
      const variable = p.references.get(node.callee)?.resolved ?? null;
      return variable === null || (variable.scope.type === 'global' && variable.defs.length === 0);
    }
    case 'Identifier': {
      const defs = p.references.get(node)?.resolved?.defs ?? [];
      const def = defs.length === 1 ? defs[0] : undefined;
      return (
        def?.type === 'Variable' &&
        def.parent.kind === 'const' &&
        def.node.id === def.name &&
        def.node.init !== null &&
        isProvablyString(p, def.node.init, depth + 1)
      );
    }
    default:
      return false;
  }
}

/**
 * Whether the form builds the same string as the source from these pieces.
 * A join prints `null` and `undefined` as an empty string where a template or
 * `+` prints `null` and `undefined`, so it applies only when every piece is
 * provably a string.
 */
function keepsMeaning(p: Parsed, node: Node, form: Form): boolean {
  return form !== 'join' || piecesOf(p, node).every((piece) => piece.kind === 'text' || isProvablyString(p, piece.node));
}

function rewrite(p: Parsed, node: Node, form: Form): Edit {
  const pieces = piecesOf(p, node);
  let text = emit(p, pieces, form);
  const parent = parentOf(p, node);
  const bare =
    form !== 'concat' ||
    parent === null ||
    LOOSE_PARENTS.has(parent.type) ||
    ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee !== node) ||
    (parent.type === 'Property' && parent.value === node) ||
    (parent.type === 'ConditionalExpression' && parent.test !== node);
  if (!bare || (form !== 'template' && parent?.type === 'NewExpression' && parent.callee === node)) text = `(${text})`;
  return replaceRange(node.range, text);
}

function stringTransform(name: string, form: Form, from: ReadonlySet<'template' | 'chain'>, summary: string): Transform {
  return { name, summary, plan: ({ p }) => targets(p, from).filter((node) => keepsMeaning(p, node, form)).map((node) => rewrite(p, node, form)) };
}

export const stringConcat = stringTransform(
  'string-concat',
  'concat',
  new Set(['template']),
  "template literals become `+` chains: `` `/a/${x}` `` becomes `'/a/' + x`",
);
export const stringTemplate = stringTransform(
  'string-template',
  'template',
  new Set(['chain']),
  "`+` chains become template literals: `'/a/' + x` becomes `` `/a/${x}` ``",
);
export const stringConcatMethod = stringTransform(
  'string-concat-method',
  'concat-method',
  new Set(['template', 'chain']),
  "templates and `+` chains become `String#concat`: `'/a/'.concat(x)`",
);
export const stringJoin = stringTransform(
  'string-join',
  'join',
  new Set(['template', 'chain']),
  "templates and `+` chains become an array join: `['/a/', x].join('')`",
);
