/**
 * The parsed view of one case that every transform reads: the ESTree from
 * `@typescript-eslint/parser` (the parser the scorer lints with), its scope
 * manager, parent links, and a few helpers over node ranges and names.
 */
import tsParser from '@typescript-eslint/parser';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

export type Node = TSESTree.Node;
export type Scope = TSESLint.Scope.Scope;
export type Variable = TSESLint.Scope.Variable;
export type Reference = TSESLint.Scope.Reference;

export interface Parsed {
  readonly source: string;
  readonly lintPath: string;
  readonly isTs: boolean;
  readonly ast: TSESTree.Program;
  readonly tokens: readonly TSESTree.Token[];
  readonly comments: readonly TSESTree.Comment[];
  readonly scopeManager: TSESLint.Scope.ScopeManager;
  /** Every node in source order (pre-order). */
  readonly nodes: readonly Node[];
  readonly parents: ReadonlyMap<Node, Node | null>;
  /** The reference each identifier is, when it is one. */
  readonly references: ReadonlyMap<Node, Reference>;
  /** 0-based offset of the start of each line; index 0 is line 1. */
  readonly lineStarts: readonly number[];
}

/** Parses a case as the scorer does. Throws the parser's error when it does not parse. */
export function parseSource(source: string, lintPath: string): Parsed {
  const result = tsParser.parseForESLint(source, {
    filePath: lintPath,
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    range: true,
    loc: true,
    tokens: true,
    comment: true,
  });
  const ast = result.ast as unknown as TSESTree.Program;
  const visitorKeys = result.visitorKeys as Readonly<Record<string, readonly string[] | undefined>>;
  const nodes: Node[] = [];
  const parents = new Map<Node, Node | null>();
  const visit = (node: Node, parent: Node | null): void => {
    nodes.push(node);
    parents.set(node, parent);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      const children = Array.isArray(child) ? child : [child];
      for (const c of children) {
        if (c !== null && typeof c === 'object' && typeof (c as { type?: unknown }).type === 'string') {
          visit(c as Node, node);
        }
      }
    }
  };
  visit(ast, null);
  const scopeManager = result.scopeManager as unknown as TSESLint.Scope.ScopeManager;
  const references = new Map<Node, Reference>();
  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references) references.set(reference.identifier, reference);
  }
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  return {
    source,
    lintPath,
    isTs: /\.tsx?$/u.test(lintPath),
    ast,
    tokens: ast.tokens ?? [],
    comments: ast.comments ?? [],
    scopeManager,
    nodes,
    parents,
    references,
    lineStarts,
  };
}

export function textOf(p: Parsed, node: Node | TSESTree.Token): string {
  return p.source.slice(node.range[0], node.range[1]);
}

export function parentOf(p: Parsed, node: Node): Node | null {
  return p.parents.get(node) ?? null;
}

export function lineStart(p: Parsed, line: number): number {
  return p.lineStarts[line - 1] ?? p.source.length;
}

/** The leading whitespace of a 1-based line. */
export function indentOf(p: Parsed, line: number): string {
  const start = lineStart(p, line);
  return /^[ \t]*/u.exec(p.source.slice(start))?.[0] ?? '';
}

/** Whether only whitespace precedes the node on its first line. */
export function startsItsLine(p: Parsed, node: Node): boolean {
  return p.source.slice(lineStart(p, node.loc.start.line), node.range[0]).trim() === '';
}

/** Whether any comment lies inside the range. */
export function hasCommentIn(p: Parsed, range: readonly [number, number]): boolean {
  return p.comments.some((c) => c.range[0] >= range[0] && c.range[1] <= range[1]);
}

export function isSingleLine(node: Node): boolean {
  return node.loc.start.line === node.loc.end.line;
}

export function isFunctionNode(node: Node): node is TSESTree.FunctionLike {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'TSDeclareFunction' ||
    node.type === 'TSEmptyBodyFunctionExpression'
  );
}

/** The nearest function around a node, or null at module level. */
export function enclosingFunction(p: Parsed, node: Node): TSESTree.FunctionLike | null {
  for (let cur = parentOf(p, node); cur !== null; cur = parentOf(p, cur)) {
    if (isFunctionNode(cur)) return cur;
  }
  return null;
}

/** The node and its descendants, without descending into nested functions. */
export function ownSubtree(p: Parsed, root: Node): Node[] {
  const out: Node[] = [];
  const start = p.nodes.indexOf(root);
  for (let i = start; i < p.nodes.length; i++) {
    const node = p.nodes[i];
    if (node === undefined || node.range[0] >= root.range[1]) break;
    if (node.range[1] > root.range[1]) continue;
    let inner = false;
    for (let cur = parentOf(p, node); cur !== null && cur !== root; cur = parentOf(p, cur)) {
      if (isFunctionNode(cur)) {
        inner = true;
        break;
      }
    }
    if (!inner) out.push(node);
  }
  return out;
}

/** The variable an identifier refers to or declares, if the scope manager knows it. */
export function variableOf(p: Parsed, identifier: Node): Variable | null {
  const reference = p.references.get(identifier);
  if (reference !== undefined) return reference.resolved;
  for (const scope of p.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (variable.identifiers.includes(identifier as TSESTree.Identifier)) return variable;
    }
  }
  return null;
}

/** Every variable the program declares, outside the global scope. */
export function declaredVariables(p: Parsed): Variable[] {
  return p.scopeManager.scopes.filter((s) => s.type !== 'global').flatMap((s) => s.variables);
}

/** `require('x')`, or `require('x').prop`: the module specifier, else null. */
export function requiredModule(node: Node | null | undefined): string | null {
  if (node === null || node === undefined) return null;
  const call = node.type === 'MemberExpression' ? node.object : node;
  if (
    call.type === 'CallExpression' &&
    call.callee.type === 'Identifier' &&
    call.callee.name === 'require' &&
    call.arguments.length === 1 &&
    call.arguments[0]?.type === 'Literal' &&
    typeof call.arguments[0].value === 'string'
  ) {
    return call.arguments[0].value;
  }
  return null;
}

/** Whether a variable is bound by `const x = require('x')` (or a destructuring of it). */
export function isRequireBinding(variable: Variable): boolean {
  return variable.defs.some((d) => d.type === 'Variable' && requiredModule(d.node.init) !== null);
}

/** Whether a variable is exported (`export const`, `export { x }`, `export default x`). */
export function isExported(p: Parsed, variable: Variable): boolean {
  for (const def of variable.defs) {
    for (let cur: Node | null = def.node; cur !== null; cur = parentOf(p, cur)) {
      if (cur.type === 'ExportNamedDeclaration' || cur.type === 'ExportDefaultDeclaration') return true;
      if (cur.type === 'Program' || isFunctionNode(cur)) break;
    }
  }
  return variable.references.some((r) => {
    const parent = parentOf(p, r.identifier);
    return parent?.type === 'ExportSpecifier' || parent?.type === 'ExportDefaultDeclaration';
  });
}

/**
 * Hands out identifiers that occur nowhere in the source (not as a variable,
 * a property or a word in a string), so a new binding can neither shadow nor
 * be shadowed.
 */
export class Names {
  private readonly used: Set<string>;
  private readonly claimed = new Set<string>();

  constructor(source: string) {
    this.used = new Set(source.match(/[A-Za-z_$][\w$]*/gu) ?? []);
  }

  fresh(base: string): string {
    let name = base;
    for (let n = 2; this.used.has(name); n++) name = `${base}${n}`;
    this.used.add(name);
    return name;
  }

  /**
   * Takes a name the source may already mention (as a property, say) but does
   * not bind; the caller has checked that. False when this run already took it.
   */
  claim(name: string): boolean {
    if (this.claimed.has(name)) return false;
    this.claimed.add(name);
    this.used.add(name);
    return true;
  }

  /** A numbered name that keeps the capitalisation of the original (JSX components stay components). */
  numbered(base: string, original: string): string {
    const capital = /^[A-Z]/u.test(original);
    const stem = capital ? base[0]?.toUpperCase() + base.slice(1) : base;
    for (let n = 1; ; n++) {
      const name = `${stem}${n}`;
      if (!this.used.has(name)) {
        this.used.add(name);
        return name;
      }
    }
  }
}
