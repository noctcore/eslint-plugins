import {
  isFunctionNode,
  loggerCallMatcher,
  loggerCallMethod,
  type LoggerCallMatcher,
  type LoggerCallOptions,
} from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-error-stringify';

export interface NoErrorStringifyOptions extends LoggerCallOptions {
  readonly errorIdentifierNames?: readonly string[];
  /**
   * Check stringified errors inside a logger call's arguments too. Off by
   * default: observability `no-error-detail-loss` owns that case and asks for
   * the error object itself, where this rule's `error.message` advice would
   * drop the stack it wants kept.
   */
  readonly checkLoggerArguments?: boolean;
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
 *
 * Inside a logger call's arguments (`logger.error(\`failed: ${err}\`)`) the rule
 * is silent unless `checkLoggerArguments` is on: observability
 * `no-error-detail-loss` covers that line and asks for the error object, which
 * keeps the stack, so the two rules never give opposite advice on one line.
 * `loggers` and `methods` take the same values as in that rule.
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
      description: 'Identifier names that always hold an error, besides catch bindings. Default `["error", "err"]`.',
    },
    checkLoggerArguments: {
      type: 'boolean',
      description:
        'Also report inside a logger call (`logger.error(`${err}`)`). Default false: observability `no-error-detail-loss` owns that case.',
    },
    loggers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Logger object names, as in observability `no-error-detail-loss`. Default `["console", "logger", "log"]`.',
    },
    methods: {
      type: 'array',
      items: { type: 'string' },
      description: 'Log-level method names, as in observability `no-error-detail-loss`.',
    },
  },
};

/** True when `node` sits inside an argument of a logger call, without crossing a function. */
function insideLoggerArgument(node: TSESTree.Node, matcher: LoggerCallMatcher): boolean {
  let child: TSESTree.Node = node;
  let current: TSESTree.Node | undefined = node.parent;
  while (current != null && !isFunctionNode(current)) {
    if (
      current.type === AST_NODE_TYPES.CallExpression &&
      current.arguments.includes(child as TSESTree.CallExpressionArgument) &&
      loggerCallMethod(current, matcher) !== null
    ) {
      return true;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

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
    const loggerArguments = options.checkLoggerArguments === true ? null : loggerCallMatcher(options);

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
      if (loggerArguments !== null && insideLoggerArgument(node, loggerArguments)) {
        return;
      }
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
