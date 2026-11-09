import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-error-stringify';

export interface NoErrorStringifyOptions {
  readonly errorIdentifierNames?: readonly string[];
}

type RuleOptions = [NoErrorStringifyOptions];
type MessageIds = 'noErrorStringify' | 'useMessage';

const DEFAULT_ERROR_NAMES: readonly string[] = ['error', 'err'];

/*
 * Flags only the unambiguous cause-chain-dropping forms: a bare `${error}`
 * interpolation, `error.toString()`, and `error + ''`. Bare `String(error)` is
 * deliberately NOT policed, because the guarded extractor idiom
 * `error instanceof Error ? error.message : String(error)` — the intended fix —
 * uses it, and banning it would flag correct code.
 *
 * Which identifiers hold an error: any binding of a `catch (x)` clause, and the
 * first parameter of a `.catch((x) => ...)` callback (or the second callback of
 * `.then`), whatever its name; plus any identifier named in
 * `errorIdentifierNames` (default `error`, `err`). Short names like `e` and
 * `cause` count only when bound by a catch, so `sizes.map((e) => \`${e}px\`)`
 * is not an error.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    errorIdentifierNames: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
  },
};

/** True for the empty-string literal `''` / `""`. */
function isEmptyStringLiteral(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal && node.value === '';
}

function isFunction(node: TSESTree.Node): node is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression {
  return node.type === AST_NODE_TYPES.ArrowFunctionExpression || node.type === AST_NODE_TYPES.FunctionExpression;
}

/** `fn` is the rejection handler of a promise chain: `.catch(fn)` or `.then(_, fn)`. */
function isRejectionHandler(fn: TSESTree.Node): boolean {
  const call = fn.parent;
  if (
    call?.type !== AST_NODE_TYPES.CallExpression ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    call.callee.computed ||
    call.callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const method = call.callee.property.name;
  return (method === 'catch' && call.arguments[0] === fn) || (method === 'then' && call.arguments[1] === fn);
}

/** The binding was introduced by a `catch` clause or as a rejection handler's first parameter. */
function isCaughtBinding(variable: TSESLint.Scope.Variable): boolean {
  return variable.defs.some((def) => {
    if (def.type === 'CatchClause') {
      return true;
    }
    if (def.type !== 'Parameter' || !isFunction(def.node)) {
      return false;
    }
    const first = def.node.params[0];
    return first !== undefined && first.range[0] <= def.name.range[0] && def.name.range[1] <= first.range[1] && isRejectionHandler(def.node);
  });
}

export const noErrorStringifyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow stringifying an error with bare `${error}` interpolation, `error.toString()`, or `error + ""`. These give "Error: <message>" or "[object Object]". Use `error instanceof Error ? error.message : String(error)` instead.',
    },
    hasSuggestions: true,
    schema: [optionSchema],
    messages: {
      noErrorStringify:
        'Stringifying `{{name}}` this way gives "Error: <message>" for an Error and "[object Object]" for a plain object. Use `{{name}} instanceof Error ? {{name}}.message : String({{name}})`, or pass the error object itself to the logger so its stack and cause are kept.',
      useMessage: 'Use `{{name}} instanceof Error ? {{name}}.message : String({{name}})`.',
    },
  },
  defaultOptions: [{ errorIdentifierNames: [...DEFAULT_ERROR_NAMES] }],
  create(context, [options]) {
    const errorNames = new Set(options.errorIdentifierNames ?? DEFAULT_ERROR_NAMES);

    function isErrorIdentifier(node: TSESTree.Node): node is TSESTree.Identifier {
      if (node.type !== AST_NODE_TYPES.Identifier) {
        return false;
      }
      if (errorNames.has(node.name)) {
        return true;
      }
      const variable = ASTUtils.findVariable(context.sourceCode.getScope(node), node);
      return variable !== null && isCaughtBinding(variable);
    }

    /**
     * Report `node`, offering to replace `replaced` with the guarded extractor.
     * `parenthesize` wraps it when it lands inside a larger expression.
     */
    function report(node: TSESTree.Node, name: string, replaced: TSESTree.Node, parenthesize: boolean): void {
      const guarded = `${name} instanceof Error ? ${name}.message : String(${name})`;
      context.report({
        node,
        messageId: 'noErrorStringify',
        data: { name },
        suggest: [
          {
            messageId: 'useMessage',
            data: { name },
            fix: (fixer) => fixer.replaceText(replaced, parenthesize ? `(${guarded})` : guarded),
          },
        ],
      });
    }

    return {
      // `error.toString()`
      'CallExpression[callee.type="MemberExpression"]'(node: TSESTree.CallExpression): void {
        const callee = node.callee as TSESTree.MemberExpression;
        if (
          !callee.computed &&
          callee.property.type === AST_NODE_TYPES.Identifier &&
          callee.property.name === 'toString' &&
          node.arguments.length === 0 &&
          isErrorIdentifier(callee.object)
        ) {
          report(node, callee.object.name, node, true);
        }
      },
      // bare `${error}` inside a template literal
      TemplateLiteral(node): void {
        for (const expr of node.expressions) {
          if (isErrorIdentifier(expr)) {
            report(expr, expr.name, expr, false);
          }
        }
      },
      // `error + ""` or `"" + error`
      BinaryExpression(node): void {
        if (node.operator !== '+') {
          return;
        }
        const sides = [node.left, node.right];
        if (!sides.some(isEmptyStringLiteral)) {
          return;
        }
        for (const side of sides) {
          if (isErrorIdentifier(side)) {
            report(node, side.name, node, true);
            return;
          }
        }
      },
    };
  },
});
