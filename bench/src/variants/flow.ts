/**
 * Value-flow rewrites at the sink: the value that reaches the sink (`req.body.url`,
 * `target`, `dto.callbackUrl`) is passed through a local variable, a helper,
 * an object property, destructuring, a spread, an array element, a promise or
 * a callback, or gets a TypeScript cast. Nothing else in the case changes.
 *
 * The value is a "leaf" on a sink line: a read of a function-local variable or
 * parameter, or a property chain on one (`req.query.next`), that is not itself
 * called. Module-level constants (`ROOT`, `ALLOWED_HOSTS`), imports and
 * globals are never leaves. Member chains come first, so `path.join(ROOT,
 * req.params.name)` moves `req.params.name`. A line that reads no local value
 * (a cookie flag inside an options object) uses the options object instead. A rewrite that needs a new
 * statement inserts it on its own line before the statement holding the sink,
 * which moves the sink and its `// expect:` label down together.
 */
import type { TSESTree } from '@typescript-eslint/utils';

import {
  enclosingFunction,
  indentOf,
  isFunctionNode,
  isRequireBinding,
  isSingleLine,
  lineStart,
  ownSubtree,
  parentOf,
  startsItsLine,
  textOf,
  type Node,
  type Parsed,
  type Variable,
} from './ast';
import { insertAt, replaceNode, replaceRange, type Edit } from './edits';
import type { Transform, TransformContext } from './transform';

interface Leaf {
  readonly node: Node;
}

interface Site {
  /** The statement the sink sits in, whose parent is a statement list. */
  readonly statement: Node;
  readonly indent: string;
  readonly inAsync: boolean;
}

/** Properties of a request that hold plain data objects, safe to copy with a spread. */
const DATA_BAGS = new Set(['body', 'query', 'params', 'headers', 'cookies', 'signedCookies', 'fields']);
/** Nest parameter decorators whose argument is a plain object of request data. */
const DATA_DECORATORS = new Set(['Body', 'Query', 'Param', 'Headers']);

function isStatementList(parent: Node, child: Node): boolean {
  if (parent.type === 'Program' || parent.type === 'BlockStatement' || parent.type === 'StaticBlock' || parent.type === 'TSModuleBlock') {
    return true;
  }
  return parent.type === 'SwitchCase' && parent.test !== child;
}

/** The variable a local read refers to, when it is a function-local variable, parameter or catch binding. */
function localVariable(p: Parsed, identifier: TSESTree.Identifier): Variable | null {
  const reference = p.references.get(identifier);
  if (reference === undefined || !reference.isValueReference || !reference.isRead()) return null;
  const variable = reference.resolved;
  if (variable === null || variable.scope.type === 'global' || variable.scope.type === 'module') return null;
  if (isRequireBinding(variable)) return null;
  const local = variable.defs.every((d) => d.type === 'Variable' || d.type === 'Parameter' || d.type === 'CatchClause');
  return local && variable.defs.length > 0 ? variable : null;
}

/** Grows an identifier into the property chain it heads, short of a call or an optional link. */
function leafOf(p: Parsed, identifier: TSESTree.Identifier): Node | null {
  let node: Node = identifier;
  for (;;) {
    const up = parentOf(p, node);
    const plainLink =
      up?.type === 'MemberExpression' && up.object === node && !up.optional && (!up.computed || up.property.type === 'Literal');
    if (!plainLink) break;
    node = up;
  }
  let parent = parentOf(p, node);
  if ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.callee === node) {
    // A method's receiver is not the value: `res` in `res.redirect(x)` is skipped, `req.query.next` in `req.query.next.trim()` is kept.
    if (node.type !== 'MemberExpression' || node.object.type !== 'MemberExpression') return null;
    node = node.object;
    parent = parentOf(p, node);
  }
  if (parent === null) return null;
  const written =
    (parent.type === 'AssignmentExpression' && parent.left === node) ||
    parent.type === 'UpdateExpression' ||
    (parent.type === 'UnaryExpression' && parent.operator === 'delete') ||
    ((parent.type === 'ForInStatement' || parent.type === 'ForOfStatement') && parent.left === node) ||
    (parent.type === 'TaggedTemplateExpression' && parent.tag === node);
  return written || !isSingleLine(node) ? null : node;
}

/** The candidate values on one sink line, member chains first, each group in source order. */
export function leavesOnLine(p: Parsed, line: number): Leaf[] {
  const chains: Leaf[] = [];
  const names: Leaf[] = [];
  const seen = new Set<Node>();
  for (const node of p.nodes) {
    if (node.type !== 'Identifier' || node.loc.start.line !== line) continue;
    const variable = localVariable(p, node);
    const leaf = variable === null ? null : leafOf(p, node);
    if (variable === null || leaf === null || seen.has(leaf)) continue;
    seen.add(leaf);
    (leaf.type === 'MemberExpression' ? chains : names).push({ node: leaf });
  }
  const found = [...chains, ...names];
  const options = found.length === 0 ? optionsObjectAround(p, line) : null;
  return options === null ? found : [{ node: options }];
}

/**
 * The fallback value of a line that reads no local value, such as a cookie
 * flag (`httpOnly: false,`): the innermost multi-line object literal, passed
 * as an argument, nested as a property value or assigned to a variable, that
 * the line sits strictly inside. Strictly inside, so its label comment moves
 * with it.
 */
function optionsObjectAround(p: Parsed, line: number): Node | null {
  let best: Node | null = null;
  for (const node of p.nodes) {
    if (node.type !== 'ObjectExpression' || node.loc.start.line >= line || node.loc.end.line <= line) continue;
    const parent = parentOf(p, node);
    const placed =
      ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.arguments.includes(node)) ||
      (parent?.type === 'Property' && parent.value === node && parentOf(p, parent)?.type === 'ObjectExpression') ||
      (parent?.type === 'VariableDeclarator' && parent.init === node);
    if (placed && (best === null || (node.range[0] >= best.range[0] && node.range[1] <= best.range[1]))) best = node;
  }
  return best;
}

/** Whether every binding the expression reads is declared before the offset (hoisted functions aside). */
function declaredBefore(p: Parsed, expression: Node, at: number): boolean {
  return p.nodes.every((node) => {
    if (node.type !== 'Identifier' || node.range[0] < expression.range[0] || node.range[1] > expression.range[1]) return true;
    const variable = p.references.get(node)?.resolved;
    if (variable === null || variable === undefined || variable.scope.type === 'global') return true;
    return variable.defs.every((d) => d.type === 'FunctionName' || d.name.range[1] <= at);
  });
}

/** Where a statement can go before the sink, or null when the leaf sits in an expression-bodied function or a class member. */
function siteOf(p: Parsed, leaf: Leaf): Site | null {
  let node: Node = leaf.node;
  let statement: Node | null = null;
  for (let parent = parentOf(p, node); parent !== null; node = parent, parent = parentOf(p, node)) {
    if (isFunctionNode(parent) || parent.type === 'ClassBody') return null;
    if (isStatementList(parent, node)) {
      statement = node;
      break;
    }
  }
  if (statement === null || !startsItsLine(p, statement)) return null;
  if (/Declaration$/u.test(statement.type) && statement.type !== 'VariableDeclaration') return null;
  const at = statement.range[0];
  if (!declaredBefore(p, leaf.node, at)) return null;
  return {
    statement,
    indent: indentOf(p, statement.loc.start.line),
    inAsync: enclosingFunction(p, statement)?.async === true,
  };
}

function insertBefore(p: Parsed, site: Site, text: string): Edit {
  return insertAt(lineStart(p, site.statement.loc.start.line), `${site.indent}${text}\n`);
}

/**
 * Plans one rewrite per sink line, on the first candidate leaf it applies to.
 * A statement already rewritten for an earlier sink line is not rewritten again.
 */
function perSink(context: TransformContext, plan: (leaf: Leaf, used: Set<Node>) => Edit[] | null): Edit[] {
  const edits: Edit[] = [];
  const used = new Set<Node>();
  for (const line of [...new Set(context.sinkLines)].sort((a, b) => a - b)) {
    for (const leaf of leavesOnLine(context.p, line)) {
      const planned = plan(leaf, used);
      if (planned !== null) {
        edits.push(...planned);
        break;
      }
    }
  }
  return edits;
}

/** A rewrite that declares the value under a new name before the statement, then reads it back. */
function declareBefore(base: string, declare: (value: string, name: string) => string, read: (name: string) => string): Transform['plan'] {
  return (context) =>
    perSink(context, (leaf) => {
      const site = siteOf(context.p, leaf);
      if (site === null) return null;
      const name = context.names.fresh(base);
      return [insertBefore(context.p, site, declare(textOf(context.p, leaf.node), name)), replaceNode(context.p, leaf.node, read(name))];
    });
}

export const viaVariable: Transform = {
  name: 'via-variable',
  summary: 'the value is first stored in a local: `const relay = req.body.url;` then `fetch(relay)`',
  plan: declareBefore('relay', (value, name) => `const ${name} = ${value};`, (name) => name),
};

export const viaObject: Transform = {
  name: 'via-object',
  summary: 'the value travels in an object property: `const holder = { value: x };` then `holder.value`',
  plan: declareBefore('holder', (value, name) => `const ${name} = { value: ${value} };`, (name) => `${name}.value`),
};

export const viaArray: Transform = {
  name: 'via-array',
  summary: 'the value travels as an array element: `const items = [x];` then `items[0]`',
  plan: declareBefore('items', (value, name) => `const ${name} = [${value}];`, (name) => `${name}[0]`),
};

/** Whether a name is bound or read as a global anywhere in the file, so a new binding of it could capture or shadow. */
function nameIsTaken(p: Parsed, name: string): boolean {
  const bound = p.scopeManager.scopes.some((s) => s.set.has(name));
  const global = (p.scopeManager.globalScope?.through ?? []).some((r) => (r.identifier as TSESTree.Identifier).name === name);
  return bound || global;
}

function propertyKey(p: Parsed, member: TSESTree.MemberExpression): { key: string; name: string | null } {
  if (!member.computed && member.property.type === 'Identifier') return { key: member.property.name, name: member.property.name };
  return { key: textOf(p, member.property), name: null };
}

export const viaDestructuring: Transform = {
  name: 'via-destructuring',
  summary: 'the value is destructured first: `const { url } = req.body;` then `fetch(url)`',
  plan: (context) =>
    perSink(context, (leaf) => {
      const { p, names } = context;
      const site = siteOf(p, leaf);
      if (site === null) return null;
      const node = leaf.node;
      if (node.type !== 'MemberExpression') {
        const name = names.fresh('picked');
        return [insertBefore(p, site, `const { value: ${name} } = { value: ${textOf(p, node)} };`), replaceNode(p, node, name)];
      }
      const { key, name: plain } = propertyKey(p, node);
      const name = plain !== null && !nameIsTaken(p, plain) && names.claim(plain) ? plain : names.fresh('picked');
      const pattern = name === key ? `{ ${key} }` : `{ ${key}: ${name} }`;
      return [insertBefore(p, site, `const ${pattern} = ${textOf(p, node.object)};`), replaceNode(p, node, name)];
    }),
};

/** Whether spreading this object into a new one keeps the property (a plain data object, not a class instance or a request). */
function isDataBag(p: Parsed, object: Node): boolean {
  if (object.type === 'MemberExpression') {
    return !object.computed && object.property.type === 'Identifier' && DATA_BAGS.has(object.property.name);
  }
  if (object.type !== 'Identifier') return false;
  const variable = p.references.get(object)?.resolved;
  return (variable?.defs ?? []).some((d) => {
    if (d.type === 'Parameter') {
      const decorators = (d.name as TSESTree.Identifier).decorators;
      return decorators.some((dec) => {
        const e = dec.expression;
        return e.type === 'CallExpression' && e.callee.type === 'Identifier' && DATA_DECORATORS.has(e.callee.name);
      });
    }
    return d.type === 'Variable' && d.node.id === d.name && d.node.init !== null && isDataBag(p, d.node.init);
  });
}

export const viaSpread: Transform = {
  name: 'via-spread',
  summary: 'the value goes through a spread: `const copy = { ...req.body };` then `copy.url`, `fetch(...[url])`, or `{ ...options }`',
  plan: (context) =>
    perSink(context, (leaf) => {
      const { p, names } = context;
      const node = leaf.node;
      if (node.type === 'ObjectExpression') return [replaceNode(p, node, `{ ...${textOf(p, node)} }`)];
      const site = siteOf(p, leaf);
      if (site !== null && node.type === 'MemberExpression' && isDataBag(p, node.object)) {
        const name = names.fresh('copy');
        const { key, name: plain } = propertyKey(p, node);
        const read = plain === null ? `${name}[${key}]` : `${name}.${plain}`;
        return [insertBefore(p, site, `const ${name} = { ...${textOf(p, node.object)} };`), replaceNode(p, node, read)];
      }
      const parent = parentOf(p, node);
      const isArgument =
        (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.arguments.includes(node as TSESTree.Expression);
      return isArgument ? [replaceNode(p, node, `...[${textOf(p, node)}]`)] : null;
    }),
};

export const viaHelper: Transform = {
  name: 'via-helper',
  summary: 'the value passes through a local identity helper: `fetch(forward(url))`, with `function forward(value) { return value; }`',
  plan: (context) => {
    const { p, names } = context;
    const name = names.fresh('forward');
    const edits = perSink(context, (leaf) => [replaceNode(p, leaf.node, `${name}(${textOf(p, leaf.node)})`)]);
    if (edits.length === 0) return [];
    const signature = p.isTs ? `function ${name}<T>(value: T): T {` : `function ${name}(value) {`;
    const lead = p.source.endsWith('\n') ? '\n' : '\n\n';
    return [...edits, insertAt(p.source.length, `${lead}${signature}\n  return value;\n}\n`)];
  },
};

export const promiseAwait: Transform = {
  name: 'promise-await',
  summary: 'the value is awaited through a promise first: `const relay = await Promise.resolve(url);` (async functions only)',
  plan: (context) =>
    perSink(context, (leaf) => {
      const site = siteOf(context.p, leaf);
      if (site === null || !site.inAsync) return null;
      const name = context.names.fresh('relay');
      const value = textOf(context.p, leaf.node);
      return [insertBefore(context.p, site, `const ${name} = await Promise.resolve(${value});`), replaceNode(context.p, leaf.node, name)];
    }),
};

function contains(outer: Node, inner: Node): boolean {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

/** `await x` with nothing but whitespace between the keyword and the operand. */
function plainAwait(p: Parsed, node: Node | null): node is TSESTree.AwaitExpression {
  return node?.type === 'AwaitExpression' && p.source.slice(node.range[0] + 'await'.length, node.argument.range[0]).trim() === '';
}

export const promiseThen: Transform = {
  name: 'promise-then',
  summary: 'the sink statement runs in a `.then` callback: `await Promise.resolve(url).then(async (relay) => { ... })` (async functions only)',
  plan: (context) =>
    perSink(context, (leaf, used) => {
      const { p } = context;
      const site = siteOf(p, leaf);
      if (site === null || !site.inAsync || used.has(site.statement)) return null;
      const statement = site.statement;
      const name = context.names.fresh('relay');
      const head = `Promise.resolve(${textOf(p, leaf.node)}).then(async (${name}) => `;
      const replaced = replaceNode(p, leaf.node, name);
      let edits: Edit[] | null = null;
      if (statement.type === 'ExpressionStatement') {
        edits = [insertAt(statement.range[0], `await ${head}{ `), replaced, insertAt(statement.range[1], ' });')];
      } else if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
        const init = statement.declarations[0]?.init ?? null;
        if (plainAwait(p, init) && contains(init.argument, leaf.node)) {
          edits = [replaceRange([init.range[0], init.argument.range[0]], `await ${head}(`), replaced, insertAt(init.argument.range[1], '))')];
        }
      } else if (statement.type === 'ReturnStatement' && statement.argument !== null) {
        const arg = statement.argument;
        edits = [insertAt(arg.range[0], `${head}(`), replaced, insertAt(arg.range[1], '))')];
      }
      if (edits !== null) used.add(statement);
      return edits;
    }),
};

export const callback: Transform = {
  name: 'callback',
  summary: 'the sink statement runs in a callback that receives the value: `[url].forEach((relay) => { ... })`',
  plan: (context) =>
    perSink(context, (leaf, used) => {
      const { p } = context;
      const site = siteOf(p, leaf);
      if (site === null || used.has(site.statement)) return null;
      const statement = site.statement;
      if (ownSubtree(p, statement).some((n) => n.type === 'AwaitExpression' || n.type === 'YieldExpression')) return null;
      const name = context.names.fresh('relay');
      const head = `[${textOf(p, leaf.node)}].forEach((${name}) => { `;
      const replaced = replaceNode(p, leaf.node, name);
      let edits: Edit[] | null = null;
      if (statement.type === 'ExpressionStatement') {
        edits = [insertAt(statement.range[0], head), replaced, insertAt(statement.range[1], ' });')];
      } else if (statement.type === 'VariableDeclaration' && statement.kind !== 'var' && statement.declarations.length === 1) {
        const declarator = statement.declarations[0];
        const init = declarator?.init ?? null;
        if (declarator?.id.type === 'Identifier' && init !== null) {
          edits = [
            replaceRange([statement.range[0], init.range[0]], `let ${textOf(p, declarator.id)}; ${head}${declarator.id.name} = `),
            replaced,
            replaceRange([init.range[1], statement.range[1]], '; });'),
          ];
        }
      }
      if (edits !== null) used.add(statement);
      return edits;
    }),
};

export const tsAsCast: Transform = {
  name: 'ts-as-cast',
  summary: 'TypeScript only: the value gets an `as` cast, `fetch(url as string)` (`as const` on an options object)',
  plan: (context) =>
    context.p.isTs
      ? perSink(context, (leaf) => {
          const cast = leaf.node.type === 'ObjectExpression' ? 'const' : 'string';
          return [replaceNode(context.p, leaf.node, `(${textOf(context.p, leaf.node)} as ${cast})`)];
        })
      : [],
};

export const tsNonNull: Transform = {
  name: 'ts-non-null',
  summary: 'TypeScript only: the value gets a non-null assertion, `fetch(url!)`',
  plan: (context) =>
    context.p.isTs
      ? perSink(context, (leaf) => (leaf.node.type === 'ObjectExpression' ? null : [replaceNode(context.p, leaf.node, `${textOf(context.p, leaf.node)}!`)]))
      : [],
};
