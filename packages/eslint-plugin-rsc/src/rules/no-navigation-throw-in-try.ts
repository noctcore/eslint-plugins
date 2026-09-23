import { ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'no-navigation-throw-in-try';

type MessageIds = 'navigationThrowInTry';

const NAVIGATION_MODULE = 'next/navigation';

/** `next/navigation` exports that work by throwing a control-flow error Next.js must see. */
const THROWING_NAVIGATION = new Set([
  'redirect',
  'permanentRedirect',
  'notFound',
  'forbidden',
  'unauthorized',
]);

const RETHROW = 'unstable_rethrow';

type Scope = TSESLint.Scope.Scope;

function fromNavigation(declaration: TSESTree.Node): boolean {
  return declaration.type === 'ImportDeclaration' && declaration.source.value === NAVIGATION_MODULE;
}

/**
 * The name a callee was imported as from `next/navigation`, or null when it is
 * not such an import. Resolved through scope, so an alias
 * (`import { redirect as go }`) is followed, a local function of the same name
 * is not, and `nav.redirect()` through `import * as nav` is recognised.
 */
function importedNavigationName(callee: TSESTree.Node, scope: Scope): string | null {
  if (callee.type === 'Identifier') {
    const def = ASTUtils.findVariable(scope, callee)?.defs[0];
    if (
      def?.type !== 'ImportBinding' ||
      def.node.type !== 'ImportSpecifier' ||
      !fromNavigation(def.parent)
    ) {
      return null;
    }
    const imported = def.node.imported;
    return imported.type === 'Identifier' ? imported.name : imported.value;
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier'
  ) {
    const def = ASTUtils.findVariable(scope, callee.object)?.defs[0];
    if (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportNamespaceSpecifier' &&
      fromNavigation(def.parent)
    ) {
      return callee.property.name;
    }
  }
  return null;
}

function isFunction(node: TSESTree.Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/** `e`, `e as Error`, `e!` → `e`. */
function unwrapExpression(node: TSESTree.Expression): TSESTree.Expression {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
}

function isParam(node: TSESTree.CallExpressionArgument | null | undefined, param: string): boolean {
  if (!node || node.type === 'SpreadElement') return false;
  const expression = unwrapExpression(node);
  return expression.type === 'Identifier' && expression.name === param;
}

/**
 * Whether `node` (outside nested functions) throws the caught value itself:
 * `throw e`, the conditional `if (isRedirectError(e)) throw e`, or any other
 * shape that hands the original error back to Next.js on at least the path that
 * matters. A wrapped `throw new Error(..., { cause: e })` does not count: Next.js
 * matches the error it threw, not one that carries it.
 */
function throwsParam(node: TSESTree.Node, param: string): boolean {
  if (isFunction(node)) return false;
  if (node.type === 'ThrowStatement') return isParam(node.argument, param);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    const children: unknown[] = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (
        typeof child === 'object' &&
        child !== null &&
        typeof (child as { type?: unknown }).type === 'string' &&
        throwsParam(child as TSESTree.Node, param)
      ) {
        return true;
      }
    }
  }
  return false;
}

export const noNavigationThrowInTryRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `redirect()`, `notFound()` and the other throwing `next/navigation` calls inside a `try` whose `catch` swallows the error instead of rethrowing it.',
    },
    schema: [],
    messages: {
      navigationThrowInTry:
        '`{{name}}()` works by throwing, and the `catch` of this `try` swallows that error, so the navigation never happens. Call `unstable_rethrow({{param}})` from `next/navigation` first in the `catch`, rethrow the caught error, or move the call out of the `try`.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;

    /** A `catch` that hands the caught error back: `unstable_rethrow(e)` or `throw e`. */
    function rethrows(handler: TSESTree.CatchClause): boolean {
      if (handler.param?.type !== 'Identifier') return false;
      const param = handler.param.name;
      const bodyScope = sourceCode.getScope(handler.body);
      for (const statement of handler.body.body) {
        if (
          statement.type === 'ExpressionStatement' &&
          statement.expression.type === 'CallExpression' &&
          importedNavigationName(statement.expression.callee, bodyScope) === RETHROW &&
          isParam(statement.expression.arguments[0], param)
        ) {
          return true;
        }
      }
      return throwsParam(handler.body, param);
    }

    return {
      CallExpression(node) {
        const name = importedNavigationName(node.callee, sourceCode.getScope(node));
        if (name === null || !THROWING_NAVIGATION.has(name)) return;

        // Walk out through every enclosing `try` until a function boundary: a
        // call inside a nested function is not executed by the `try` it is
        // written in. A `catch` that rethrows passes the error to the next `try`
        // out, so the walk continues past it.
        let child: TSESTree.Node = node;
        for (
          let current: TSESTree.Node | undefined = node.parent;
          current !== undefined;
          current = current.parent
        ) {
          if (isFunction(current)) return;
          if (current.type === 'TryStatement' && current.block === child && current.handler) {
            if (!rethrows(current.handler)) {
              const param =
                current.handler.param?.type === 'Identifier' ? current.handler.param.name : 'error';
              context.report({ node, messageId: 'navigationThrowInTry', data: { name, param } });
              return;
            }
          }
          child = current;
        }
      },
    };
  },
});
