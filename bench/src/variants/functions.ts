/**
 * Function-style rewrites: arrow functions and function expressions swap
 * forms where that cannot change behaviour, that is where the body never
 * reads `this`, `arguments`, `super` or `new.target`. A handler written
 * `async function (req, res) {}` must be judged like `async (req, res) => {}`.
 * Typed rewrites: TypeScript annotations on bindings that have none.
 */
import type { TSESTree } from '@typescript-eslint/utils';

import { isFunctionNode, parentOf, type Node, type Parsed } from './ast';
import { insertAt, replaceRange, type Edit } from './edits';
import type { Transform } from './transform';

/** Whether a function's own body (not nested non-arrow functions or classes) reads a binding that arrows and functions resolve differently. */
function usesOwnThis(p: Parsed, fn: Node): boolean {
  for (const node of p.nodes) {
    if (node.range[0] < fn.range[0] || node.range[1] > fn.range[1] || node === fn) continue;
    let boundary = false;
    for (let cur = parentOf(p, node); cur !== null && cur !== fn; cur = parentOf(p, cur)) {
      if ((isFunctionNode(cur) && cur.type !== 'ArrowFunctionExpression') || cur.type === 'ClassBody') {
        boundary = true;
        break;
      }
    }
    if (boundary) continue;
    if (node.type === 'ThisExpression' || node.type === 'Super' || node.type === 'MetaProperty') return true;
    if (node.type === 'Identifier' && node.name === 'arguments' && p.references.has(node)) return true;
  }
  return false;
}

function tokenIndexAt(p: Parsed, offset: number): number {
  return p.tokens.findIndex((t) => t.range[0] >= offset);
}

function arrowToFunction(p: Parsed, arrow: TSESTree.ArrowFunctionExpression): Edit[] | null {
  if (arrow.typeParameters !== undefined || usesOwnThis(p, arrow)) return null;
  const edits: Edit[] = [];
  const firstParam = arrow.params[0];
  const asyncOffset = arrow.async ? 'async'.length : 0;
  const open = p.tokens[tokenIndexAt(p, arrow.range[0] + asyncOffset)];
  if (open?.value === '(') {
    edits.push(insertAt(open.range[0], 'function '));
  } else if (firstParam !== undefined) {
    edits.push(insertAt(firstParam.range[0], 'function ('), insertAt(firstParam.range[1], ')'));
  } else {
    return null;
  }
  // The `=>` is the token before the body, or before the parentheses around an expression body.
  let index = tokenIndexAt(p, arrow.body.range[0]) - 1;
  let parens = 0;
  for (; p.tokens[index]?.value === '('; index--) parens++;
  const arrowToken = p.tokens[index];
  const bodyStart = p.tokens[index + 1]?.range[0];
  if (arrowToken?.value !== '=>' || bodyStart === undefined) return null;
  const end = arrowToken.range[1] + (p.source[arrowToken.range[1]] === ' ' ? 1 : 0);
  edits.push(replaceRange([arrowToken.range[0], end], ''));
  if (arrow.body.type !== 'BlockStatement') {
    const closeAt = tokenIndexAt(p, arrow.body.range[1]);
    const close = parens === 0 ? undefined : p.tokens[closeAt + parens - 1];
    if (parens > 0 && close?.value !== ')') return null;
    edits.push(insertAt(bodyStart, '{ return '), insertAt(close?.range[1] ?? arrow.body.range[1], '; }'));
  }
  return edits;
}

function functionToArrow(p: Parsed, fn: TSESTree.FunctionExpression): Edit[] | null {
  if (fn.id !== null || fn.generator || fn.typeParameters !== undefined || usesOwnThis(p, fn)) return null;
  const parent = parentOf(p, fn);
  if (parent === null) return null;
  if (parent.type === 'MethodDefinition' || parent.type === 'TSAbstractMethodDefinition') return null;
  if (parent.type === 'Property' && (parent.method || parent.kind !== 'init')) return null;
  if (parent.type === 'NewExpression' && parent.callee === fn) return null;
  const keyword = p.tokens[tokenIndexAt(p, fn.range[0] + (fn.async ? 'async'.length : 0))];
  if (keyword?.value !== 'function') return null;
  const next = p.tokens[tokenIndexAt(p, keyword.range[1])];
  if (next === undefined) return null;
  return [replaceRange([keyword.range[0], next.range[0]], ''), insertAt(fn.body.range[0], '=> ')];
}

function functionPlan(p: Parsed, kind: 'arrow' | 'function'): Edit[] {
  const edits: Edit[] = [];
  for (const node of p.nodes) {
    const planned =
      kind === 'arrow' && node.type === 'ArrowFunctionExpression'
        ? arrowToFunction(p, node)
        : kind === 'function' && node.type === 'FunctionExpression'
          ? functionToArrow(p, node)
          : null;
    if (planned !== null) edits.push(...planned);
  }
  return edits;
}

export const arrowFunctions: Transform = {
  name: 'arrow-to-function',
  summary: 'arrow functions that do not read `this` or `arguments` become function expressions',
  plan: ({ p }) => functionPlan(p, 'arrow'),
};

export const functionArrows: Transform = {
  name: 'function-to-arrow',
  summary: 'anonymous function expressions that do not read `this` or `arguments` become arrow functions',
  plan: ({ p }) => functionPlan(p, 'function'),
};

/** A binding's annotation from its initialiser when that is obvious, else `any`. */
function annotationFor(init: Node | null): string {
  if (init === null) return 'any';
  if ((init.type === 'Literal' && typeof init.value === 'string') || init.type === 'TemplateLiteral') return 'string';
  if (init.type === 'Literal' && typeof init.value === 'number') return 'number';
  if (init.type === 'Literal' && typeof init.value === 'boolean') return 'boolean';
  return 'any';
}

function annotationPlan(p: Parsed): Edit[] {
  if (!p.isTs) return [];
  const edits: Edit[] = [];
  for (const node of p.nodes) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.typeAnnotation === undefined && node.init !== null) {
      const holder = parentOf(p, parentOf(p, node) ?? node);
      if (holder?.type === 'ForInStatement' || holder?.type === 'ForOfStatement') continue;
      edits.push(insertAt(node.id.range[1], `: ${annotationFor(node.init)}`));
    }
    if (!isFunctionNode(node)) continue;
    for (const param of node.params) {
      if (param.type !== 'Identifier' || param.typeAnnotation !== undefined || param.optional) continue;
      const wrapped =
        node.type === 'ArrowFunctionExpression' && node.params.length === 1 && p.tokens[tokenIndexAt(p, param.range[0]) - 1]?.value !== '(';
      edits.push(wrapped ? replaceRange(param.range, `(${param.name}: any)`) : insertAt(param.range[1], ': any'));
    }
  }
  return edits;
}

export const tsAnnotations: Transform = {
  name: 'ts-annotations',
  summary: 'TypeScript only: unannotated variables and parameters get type annotations (`: string`, `: any`)',
  plan: ({ p }) => annotationPlan(p),
};
