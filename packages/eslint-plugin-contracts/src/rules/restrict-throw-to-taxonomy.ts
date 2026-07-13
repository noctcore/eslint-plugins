import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'restrict-throw-to-taxonomy';

export interface RestrictThrowToTaxonomyOptions {
  /** Constructor names permitted as throw targets (your error taxonomy). Default `['Error']`. */
  readonly allow?: readonly string[];
}

type RuleOptions = [RestrictThrowToTaxonomyOptions];
type MessageIds = 'disallowedErrorClass' | 'nonErrorThrow';

/*
 * A `throw` should raise a member of the project's error taxonomy — never an ad
 * hoc built-in nor a bare value. This rule flags:
 *   - `throw new SomethingError(...)` whose constructor is NOT in `allow`
 *     (`allow` defaults to `['Error']`; extend it with your base errors and any
 *     built-ins you legitimately raise, e.g. `['Error', 'AppError', 'TypeError']`).
 *   - `throw <non-Error value>` — a string, number, boolean, template literal,
 *     object, or array literal, which cannot carry a stack or a cause.
 *
 * Conservative on the ambiguous forms: a bare identifier (`throw err` re-throw),
 * a member (`throw ctx.error`), and a call (`throw makeError()`) are all left
 * alone — a syntactic rule cannot know whether they resolve to an Error, and
 * re-throwing a caught error is the single most common `throw` in real code.
 */
const DEFAULT_ALLOW: readonly string[] = ['Error'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allow: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

/** The constructor's simple name (`TypeError`, `errors.AppError` -> `AppError`), or null. */
function constructorSimpleName(node: TSESTree.NewExpression): string | null {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
}

/** True for literal shapes that are unambiguously non-Error values. */
function isNonErrorValue(node: TSESTree.Expression): boolean {
  return (
    node.type === AST_NODE_TYPES.Literal ||
    node.type === AST_NODE_TYPES.TemplateLiteral ||
    node.type === AST_NODE_TYPES.ObjectExpression ||
    node.type === AST_NODE_TYPES.ArrayExpression
  );
}

export const restrictThrowToTaxonomyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Restrict `throw` to an approved error taxonomy. Flags throwing a non-allowlisted error class and throwing a non-Error value (string, object, number, ...).',
    },
    schema: [optionSchema],
    messages: {
      disallowedErrorClass:
        'Throw an error from your taxonomy, not `{{name}}`. Allowed: {{allowed}}. Add `{{name}}` to the `allow` option if it belongs to your taxonomy.',
      nonErrorThrow:
        'Throw an Error from your taxonomy, not a bare {{kind}} value. A non-Error throw carries no stack or cause.',
    },
  },
  defaultOptions: [{ allow: [...DEFAULT_ALLOW] }],
  create(context, [options]) {
    const allow = new Set(options.allow ?? DEFAULT_ALLOW);
    const allowedList = [...allow].join(', ');

    return {
      ThrowStatement(node): void {
        const arg = node.argument;

        if (arg.type === AST_NODE_TYPES.NewExpression) {
          const name = constructorSimpleName(arg);
          // An unresolvable constructor (computed/dynamic) is left alone.
          if (name !== null && !allow.has(name)) {
            context.report({
              node: arg,
              messageId: 'disallowedErrorClass',
              data: { name, allowed: allowedList },
            });
          }
          return;
        }

        if (isNonErrorValue(arg)) {
          const kind =
            arg.type === AST_NODE_TYPES.ObjectExpression
              ? 'object'
              : arg.type === AST_NODE_TYPES.ArrayExpression
                ? 'array'
                : 'literal';
          context.report({ node: arg, messageId: 'nonErrorThrow', data: { kind } });
        }
      },
    };
  },
});
