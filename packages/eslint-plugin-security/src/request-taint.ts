import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { type GuardContext, isProvenSafeValue } from './guards';

/*
 * In-function data flow from request-shaped input to a sink, without type
 * information. A value carries the request when it is, or is built from, a
 * member of a request object (`req.query.file`, `req.body?.name`):
 *
 *  - through `const` and `let` bindings (every write is followed), destructuring
 *    and `for...of` over a carrying value;
 *  - through string building (`+`, templates), `?:`, `||` / `??`;
 *  - through member access (`parts[0]`, `JSON.parse(x).value`) and object or
 *    array literals holding it, getters included;
 *  - through calls: a call with a carrying argument, receiver or callee carries
 *    it (`trim(x)`, `x.split(',')`, `readInput()` when `readInput` was built
 *    from it), unless the callee is a known sanitizer for the sink;
 *  - through `arr.push(x)` into `arr`.
 *
 * At each binding the sink's guard is asked first (`../guards`): a value
 * checked against an allowlist or a safe anchored regex before the sink stops
 * the flow there.
 */

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

const MAX_DEPTH = 24;

/** Calls whose result carries none of the input's characters that matter. */
const NUMERIC_CALLS: ReadonlySet<string> = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean']);
/** Properties whose value is not the input's text. */
const NON_TEXT_PROPERTIES: ReadonlySet<string> = new Set(['length', 'size']);
/** Methods that put a value into the array they are called on. */
const ARRAY_WRITERS: ReadonlySet<string> = new Set(['push', 'unshift', 'splice', 'fill']);

export interface TaintOptions {
  /** Root identifiers of request-shaped input (`req`, `request`, `ctx`). */
  readonly requestObjects: ReadonlySet<string>;
  /** Where the value is used: decides which guards and sanitizers count. */
  readonly context: GuardContext;
  /** Callee source texts whose result is safe for the sink (`path.basename`). */
  readonly sanitizers: ReadonlySet<string>;
}

interface Walk {
  readonly options: TaintOptions;
  readonly sink: TSESTree.Node;
  readonly sourceCode: SourceCode;
  readonly seen: Set<Variable>;
}

/**
 * The request member a value carries at `sink` (`req.query.file`), or null
 * when none reaches it.
 */
export function requestSourceOf(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  options: TaintOptions,
  sourceCode: SourceCode,
): TSESTree.Node | null {
  return carried(node, { options, sink, sourceCode, seen: new Set() }, 0);
}

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current: TSESTree.Node = node;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
    } else if (
      current.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.type === AST_NODE_TYPES.TSAsExpression
    ) {
      current = current.expression;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

function isRequestMember(node: TSESTree.Node, requestObjects: ReadonlySet<string>): boolean {
  const inner = node.type === AST_NODE_TYPES.ChainExpression ? node.expression : node;
  if (inner.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const root = rootIdentifier(inner);
  return root !== null && requestObjects.has(root.name);
}

function carried(raw: TSESTree.Node, walk: Walk, depth: number): TSESTree.Node | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  const next = (child: TSESTree.Node | null | undefined): TSESTree.Node | null =>
    child == null ? null : carried(child, walk, depth + 1);
  const firstOf = (children: readonly (TSESTree.Node | null)[]): TSESTree.Node | null => {
    for (const child of children) {
      const found = next(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  if (isRequestMember(raw, walk.options.requestObjects)) {
    return raw;
  }
  const node = raw;
  switch (node.type) {
    case AST_NODE_TYPES.Identifier:
      return carriedByVariable(node, walk, depth);
    case AST_NODE_TYPES.ChainExpression:
      return next(node.expression);
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSTypeAssertion:
      return next(node.expression);
    case AST_NODE_TYPES.AwaitExpression:
      return next(node.argument);
    case AST_NODE_TYPES.TemplateLiteral:
      return firstOf(node.expressions);
    case AST_NODE_TYPES.TaggedTemplateExpression:
      return firstOf(node.quasi.expressions);
    case AST_NODE_TYPES.BinaryExpression:
      // Only `+` builds a string; comparisons and arithmetic yield booleans and numbers.
      return node.operator === '+' ? firstOf([node.left, node.right]) : null;
    case AST_NODE_TYPES.LogicalExpression:
      return firstOf([node.left, node.right]);
    case AST_NODE_TYPES.ConditionalExpression:
      return firstOf([node.consequent, node.alternate]);
    case AST_NODE_TYPES.SequenceExpression:
      return next(node.expressions.at(-1));
    case AST_NODE_TYPES.AssignmentExpression:
      return next(node.right);
    case AST_NODE_TYPES.MemberExpression:
      if (
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        NON_TEXT_PROPERTIES.has(node.property.name)
      ) {
        return null;
      }
      return next(node.object);
    case AST_NODE_TYPES.ArrayExpression:
      return firstOf(node.elements.map((element) => element ?? null));
    case AST_NODE_TYPES.SpreadElement:
      return next(node.argument);
    case AST_NODE_TYPES.ObjectExpression:
      return firstOf(node.properties.map((property) => property));
    case AST_NODE_TYPES.Property:
      if (
        node.value.type === AST_NODE_TYPES.FunctionExpression ||
        node.value.type === AST_NODE_TYPES.ArrowFunctionExpression
      ) {
        return carriedByReturn(node.value, walk, depth);
      }
      return next(node.value);
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.FunctionExpression:
      return carriedByReturn(node, walk, depth);
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return carriedByCall(node, walk, depth);
    default:
      return null;
  }
}

/** A function value carries the request when it returns a carrying value (a closure over it). */
function carriedByReturn(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
  walk: Walk,
  depth: number,
): TSESTree.Node | null {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return carried(fn.body, walk, depth + 1);
  }
  for (const statement of fn.body.body) {
    if (statement.type === AST_NODE_TYPES.ReturnStatement && statement.argument !== null) {
      const found = carried(statement.argument, walk, depth + 1);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function carriedByCall(
  node: TSESTree.CallExpression | TSESTree.NewExpression,
  walk: Walk,
  depth: number,
): TSESTree.Node | null {
  const callee = node.callee;
  const calleeText = squash(walk.sourceCode.getText(callee));
  if (walk.options.sanitizers.has(calleeText)) {
    return null;
  }
  if (callee.type === AST_NODE_TYPES.Identifier && NUMERIC_CALLS.has(callee.name)) {
    return null;
  }
  for (const arg of node.arguments) {
    const found = carried(arg, walk, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  if (callee.type === AST_NODE_TYPES.MemberExpression) {
    return carried(callee.object, walk, depth + 1);
  }
  if (callee.type === AST_NODE_TYPES.Identifier) {
    const variable = ASTUtils.findVariable(walk.sourceCode.getScope(callee), callee);
    const def = variable?.defs[0];
    // A local function value built from the request: `const read = capture(input); read()`.
    if (def?.type === 'Variable') {
      return carried(callee, walk, depth + 1);
    }
  }
  return null;
}

function carriedByVariable(node: TSESTree.Identifier, walk: Walk, depth: number): TSESTree.Node | null {
  const variable = ASTUtils.findVariable(walk.sourceCode.getScope(node), node);
  if (variable === null || walk.seen.has(variable)) {
    return null;
  }
  if (isProvenSafeValue(node, walk.sink, walk.options.context, walk.sourceCode)) {
    return null;
  }
  walk.seen.add(variable);
  try {
    for (const reference of variable.references) {
      if (reference.isWrite() && reference.writeExpr != null) {
        const found = carried(reference.writeExpr, walk, depth + 1);
        if (found !== null) {
          return found;
        }
        continue;
      }
      // `arr.push(x)`, `arr[i] = x`: a write into the array the binding holds.
      const parent = reference.identifier.parent;
      if (parent?.type !== AST_NODE_TYPES.MemberExpression || parent.object !== reference.identifier) {
        continue;
      }
      const grand = parent.parent;
      if (
        grand?.type === AST_NODE_TYPES.CallExpression &&
        grand.callee === parent &&
        !parent.computed &&
        parent.property.type === AST_NODE_TYPES.Identifier &&
        ARRAY_WRITERS.has(parent.property.name)
      ) {
        for (const arg of grand.arguments) {
          const found = carried(arg, walk, depth + 1);
          if (found !== null) {
            return found;
          }
        }
      } else if (grand?.type === AST_NODE_TYPES.AssignmentExpression && grand.left === parent) {
        const found = carried(grand.right, walk, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  } finally {
    walk.seen.delete(variable);
  }
}
