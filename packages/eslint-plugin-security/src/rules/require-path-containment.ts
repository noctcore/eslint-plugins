import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'require-path-containment';

export interface RequirePathContainmentOptions {
  readonly requestObjects?: readonly string[];
}

type RuleOptions = [RequirePathContainmentOptions];
type MessageIds = 'unguardedPathJoin';

/*
 * Path-traversal precision — OPT-IN. `path.join(baseDir, req.params.file)` lets a
 * crafted `../../etc/passwd` escape the intended directory. The safe pattern is
 * to resolve, then verify the result still starts with the base dir (or normalize
 * and reject `..`) before touching the filesystem.
 *
 * DELIBERATELY NARROW to stay high-precision without type information: it fires
 * only when a `req.*` / `request.*` member expression is passed DIRECTLY into
 * `path.join(...)` / `path.resolve(...)`, and the enclosing function contains no
 * containment guard. A guard is any `path.normalize` / `path.relative` /
 * `.startsWith(...)` call in the same function, or an escape-hatch comment
 * containing `path-containment` (e.g. `// path-containment: base is a constant`).
 * Because a sanitized value is bound to a local first (`const safe = clean(req.x)`
 * → `path.join(base, safe)`), that shape is not a direct `req.*` argument and is
 * never flagged.
 *
 * This is a HIGH-false-positive family, so the rule is exported and documented
 * but NOT in the `recommended` preset — enable it explicitly. Broader
 * "handler params / decoded payloads" sources are intentionally out of scope:
 * proving them user-shaped needs type/dataflow analysis this syntactic rule
 * cannot do soundly.
 */
const DEFAULT_REQUEST_OBJECTS: readonly string[] = ['req', 'request'];
const HATCH_TOKEN = 'path-containment';
const GUARD_PROPERTIES: ReadonlySet<string> = new Set([
  'normalize',
  'relative',
  'startsWith',
]);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestObjects: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

/** The `path.join` / `path.resolve` method name, or null for any other callee. */
function pathBuilderMethod(callee: TSESTree.Node): string | null {
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.object.type !== AST_NODE_TYPES.Identifier ||
    callee.object.name !== 'path' ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  const method = callee.property.name;
  return method === 'join' || method === 'resolve' ? method : null;
}

/** The root identifier of a member chain (`req.params.file` → `req`), else null. */
function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current: TSESTree.Node = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    current = current.object;
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

type ScopeNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression
  | TSESTree.Program;

/** Nearest enclosing function, or the Program when at module top level. */
function enclosingScope(node: TSESTree.Node): ScopeNode {
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (
      current.type === AST_NODE_TYPES.FunctionDeclaration ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.Program
    ) {
      return current;
    }
    current = current.parent;
  }
  return node as unknown as TSESTree.Program;
}

/** True when the scope subtree contains a normalize / relative / startsWith call. */
function hasContainmentGuard(scope: ScopeNode): boolean {
  let found = false;
  function walk(node: TSESTree.Node): void {
    if (found) {
      return;
    }
    if (
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.MemberExpression &&
      !node.callee.computed &&
      node.callee.property.type === AST_NODE_TYPES.Identifier &&
      GUARD_PROPERTIES.has(node.callee.property.name)
    ) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') {
        continue;
      }
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof (child as { type?: unknown }).type === 'string') {
            walk(child as TSESTree.Node);
          }
        }
      } else if (value && typeof (value as { type?: unknown }).type === 'string') {
        walk(value as TSESTree.Node);
      }
    }
  }
  walk(scope);
  return found;
}

export const requirePathContainmentRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Request-shaped input (`req.*`) passed directly into `path.join` / `path.resolve` without a containment guard is a path-traversal sink. Opt-in — enable explicitly.',
    },
    schema: [optionSchema],
    messages: {
      unguardedPathJoin:
        '`{{source}}` (request-shaped input) flows into `path.{{method}}(...)` with no containment guard — a path-traversal sink. Resolve then verify the result stays under the base dir (`resolved.startsWith(baseDir)`) or normalize and reject `..`. If this path is already safe, add a `// path-containment: <reason>` comment.',
    },
  },
  defaultOptions: [{ requestObjects: DEFAULT_REQUEST_OBJECTS }],
  create(context, [options]) {
    const requestObjects = new Set(
      options.requestObjects ?? DEFAULT_REQUEST_OBJECTS,
    );

    return {
      CallExpression(node): void {
        const method = pathBuilderMethod(node.callee);
        if (method === null) {
          return;
        }

        // A direct `req.*` / `request.*` member argument is the tracked sink.
        let source: TSESTree.MemberExpression | null = null;
        for (const arg of node.arguments) {
          if (arg.type !== AST_NODE_TYPES.MemberExpression) {
            continue;
          }
          const root = rootIdentifier(arg);
          if (root !== null && requestObjects.has(root.name)) {
            source = arg;
            break;
          }
        }
        if (source === null) {
          return;
        }

        const scope = enclosingScope(node);
        if (hasContainmentGuard(scope)) {
          return;
        }
        // Escape-hatch: any `path-containment` comment inside the scope silences.
        const hatched = context.sourceCode
          .getAllComments()
          .some(
            (comment) =>
              comment.range[0] >= scope.range[0] &&
              comment.range[1] <= scope.range[1] &&
              comment.value.includes(HATCH_TOKEN),
          );
        if (hatched) {
          return;
        }

        context.report({
          node,
          messageId: 'unguardedPathJoin',
          data: {
            source: context.sourceCode.getText(source),
            method,
          },
        });
      },
    };
  },
});
