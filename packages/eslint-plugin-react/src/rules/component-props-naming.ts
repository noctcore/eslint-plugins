import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'component-props-naming';

export interface ComponentPropsNamingOptions {
  readonly requireExported?: boolean;
}

type RuleOptions = [ComponentPropsNamingOptions];
type MessageIds = 'propsNaming';

/*
 * A function component's props type should be named `<Component>Props`. That
 * convention makes the contract discoverable (`ButtonProps` sits next to
 * `Button`) and is what a dozen sibling rules key off. This rule flags a
 * PascalCase, JSX-returning function component whose first parameter is annotated
 * with a plain named type that is NOT `<Component>Props`, and — when it is safe —
 * autofixes by renaming the type declaration and every in-file reference.
 *
 * Precision guardrails (syntactic, no type information):
 *  - only PascalCase functions that actually return JSX are treated as components
 *    (so `makeThing`, hooks, and non-component factories are never touched);
 *  - the first param's annotation must be a bare type reference with no type
 *    arguments (so wrappers like `PropsWithChildren<Props>` / `React.FC` args are
 *    left alone — there is no single name to rename);
 *  - the autofix runs ONLY when the type is declared in this file, is NOT exported
 *    (renaming an exported type would break other files' imports), the target name
 *    is free, and no OTHER component shares the type. Otherwise the rule reports
 *    without a fix.
 *
 * `requireExported` (default false): when true, only exported components are
 * checked; internal/local components are ignored.
 */

type FnNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requireExported: { type: 'boolean' },
  },
};

/** True when an expression is — or, unwrapped through ternary/logical, contains — top-level JSX. */
function isJsxExpression(node: TSESTree.Node | null | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case AST_NODE_TYPES.JSXElement:
    case AST_NODE_TYPES.JSXFragment:
      return true;
    case AST_NODE_TYPES.ConditionalExpression:
      return isJsxExpression(node.consequent) || isJsxExpression(node.alternate);
    case AST_NODE_TYPES.LogicalExpression:
      return isJsxExpression(node.left) || isJsxExpression(node.right);
    default:
      return false;
  }
}

function isFunctionNode(node: TSESTree.Node): node is FnNode {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  );
}

function enclosingFunction(node: TSESTree.Node): FnNode | null {
  let current = node.parent;
  while (current) {
    if (isFunctionNode(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** All descendant nodes of `root` (inclusive), never crossing the `parent` back-edge. */
function descendants(root: TSESTree.Node): TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as TSESTree.Node;
    out.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'parent') {
        continue;
      }
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            stack.push(child);
          }
        }
      } else if (isNode(value)) {
        stack.push(value);
      }
    }
  }
  return out;
}

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/** True when `fn`'s own body returns JSX (not counting returns in nested functions). */
function functionReturnsJsx(fn: FnNode): boolean {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return isJsxExpression(fn.body);
  }
  return descendants(fn.body).some(
    (node) =>
      node.type === AST_NODE_TYPES.ReturnStatement &&
      enclosingFunction(node) === fn &&
      isJsxExpression(node.argument),
  );
}

/** Component name from the function's id or the variable it is assigned to. */
function componentNameOf(fn: FnNode): string | undefined {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration) {
    return fn.id?.name;
  }
  if (fn.type === AST_NODE_TYPES.FunctionExpression && fn.id) {
    return fn.id.name;
  }
  const parent = fn.parent;
  if (
    parent?.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  return undefined;
}

function isExportedFn(fn: FnNode): boolean {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration) {
    return (
      fn.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration ||
      fn.parent?.type === AST_NODE_TYPES.ExportDefaultDeclaration
    );
  }
  const declarator = fn.parent;
  if (declarator?.type === AST_NODE_TYPES.VariableDeclarator) {
    return declarator.parent?.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration;
  }
  return false;
}

/** The bare, un-parameterised type-reference Identifier annotating the first param, or null. */
function firstParamTypeRef(fn: FnNode): TSESTree.Identifier | null {
  let param = fn.params[0];
  if (!param) {
    return null;
  }
  if (param.type === AST_NODE_TYPES.AssignmentPattern) {
    param = param.left;
  }
  const typeAnnotation =
    'typeAnnotation' in param ? (param.typeAnnotation ?? undefined) : undefined;
  if (!typeAnnotation || typeAnnotation.type !== AST_NODE_TYPES.TSTypeAnnotation) {
    return null;
  }
  const annotated = typeAnnotation.typeAnnotation;
  if (
    annotated.type !== AST_NODE_TYPES.TSTypeReference ||
    annotated.typeArguments !== undefined ||
    annotated.typeName.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  return annotated.typeName;
}

interface Candidate {
  readonly componentName: string;
  readonly propsTypeName: string;
  readonly typeRefNode: TSESTree.Identifier;
}

export const componentPropsNamingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "A function component's first-param props type must be named `<Component>Props`. Autofixes by renaming the in-file type declaration and its references when that is safe.",
    },
    fixable: 'code',
    schema: [optionSchema],
    messages: {
      propsNaming:
        'Props type for `{{component}}` should be named `{{expected}}`, not `{{actual}}` — a `<Component>Props` name keeps the contract discoverable.',
    },
  },
  defaultOptions: [{ requireExported: false }],
  create(context, [options]) {
    const requireExported = options.requireExported ?? false;

    const typeDecls = new Map<string, { id: TSESTree.Identifier; exported: boolean }>();
    const typeRefs = new Map<string, TSESTree.Identifier[]>();
    const candidates: Candidate[] = [];

    function recordTypeDecl(
      node: TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration,
    ): void {
      typeDecls.set(node.id.name, {
        id: node.id,
        exported: node.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration,
      });
    }

    function considerFunction(fn: FnNode): void {
      const componentName = componentNameOf(fn);
      if (componentName === undefined || !/^[A-Z]/.test(componentName)) {
        return;
      }
      if (requireExported && !isExportedFn(fn)) {
        return;
      }
      const typeRef = firstParamTypeRef(fn);
      if (typeRef === null || !functionReturnsJsx(fn)) {
        return;
      }
      if (typeRef.name === `${componentName}Props`) {
        return;
      }
      candidates.push({ componentName, propsTypeName: typeRef.name, typeRefNode: typeRef });
    }

    return {
      TSInterfaceDeclaration: recordTypeDecl,
      TSTypeAliasDeclaration: recordTypeDecl,
      TSTypeReference(node): void {
        if (node.typeName.type === AST_NODE_TYPES.Identifier) {
          const name = node.typeName.name;
          const list = typeRefs.get(name) ?? [];
          list.push(node.typeName);
          typeRefs.set(name, list);
        }
      },
      FunctionDeclaration: considerFunction,
      FunctionExpression: considerFunction,
      ArrowFunctionExpression: considerFunction,
      'Program:exit'(): void {
        // How many distinct components share each props type name.
        const usedBy = new Map<string, Set<string>>();
        for (const candidate of candidates) {
          const set = usedBy.get(candidate.propsTypeName) ?? new Set<string>();
          set.add(candidate.componentName);
          usedBy.set(candidate.propsTypeName, set);
        }

        for (const candidate of candidates) {
          const expected = `${candidate.componentName}Props`;
          const decl = typeDecls.get(candidate.propsTypeName);
          const targetTaken = typeDecls.has(expected);
          const sharedByMany = (usedBy.get(candidate.propsTypeName)?.size ?? 0) > 1;
          const canFix =
            decl !== undefined && !decl.exported && !targetTaken && !sharedByMany;

          if (canFix) {
            context.report({
              node: candidate.typeRefNode,
              messageId: 'propsNaming',
              data: { component: candidate.componentName, actual: candidate.propsTypeName, expected },
              fix(fixer) {
                const targets: TSESTree.Identifier[] = [
                  decl.id,
                  ...(typeRefs.get(candidate.propsTypeName) ?? []),
                ];
                const seen = new Set<string>();
                const fixes = [];
                for (const target of targets) {
                  const key = `${target.range[0]}:${target.range[1]}`;
                  if (seen.has(key)) {
                    continue;
                  }
                  seen.add(key);
                  fixes.push(fixer.replaceText(target, expected));
                }
                return fixes;
              },
            });
          } else {
            context.report({
              node: candidate.typeRefNode,
              messageId: 'propsNaming',
              data: { component: candidate.componentName, actual: candidate.propsTypeName, expected },
            });
          }
        }
      },
    };
  },
});
