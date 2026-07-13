import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'require-error-cause';

type MessageIds = 'missingCause';

/*
 * Inside a `catch (err)` block, re-throwing a NEW error without `{ cause: err }`
 * severs the chain to the original failure: the stack that reaches the logger
 * points only at the re-throw site, and the underlying error is gone. This rule
 * flags `throw new SomeError(...)` in a catch when no argument carries a `cause`
 * property, and autofixes by attaching `{ cause: <binding> }`.
 *
 * SCOPE — deliberately conservative to stay false-positive-free:
 *   - Only NewExpressions whose constructor's simple name ends in `Error` or
 *     `Exception` are treated as errors (`Error`, `TypeError`, `ValidationError`,
 *     `HttpException`). Throwing an unrelated `new Response(...)` is not policed.
 *   - Fires only when the enclosing catch binds a plain identifier (`catch (err)`).
 *     A parameterless `catch {}` or a destructured binding has no single name to
 *     reference, so the throw is left alone.
 *   - "Already has a cause" is satisfied by ANY `cause` property in ANY argument
 *     object (whatever its value), and by any spread the rule cannot see through
 *     — both suppress the report so a hand-written cause is never second-guessed.
 *
 * The enclosing-catch binding is tracked with a stack pushed on `CatchClause`
 * enter and popped on exit. Because traversal is depth-first, a `throw` nested in
 * a closure declared inside the catch still sees that catch on top of the stack —
 * the binding is genuinely in lexical scope there, so attaching it is correct.
 */

/** The constructor's simple name (`Error`, `errors.ValidationError` -> `ValidationError`), or null. */
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

/** True for a constructor name that reads as an error type. */
function isErrorLikeName(name: string): boolean {
  return /(?:Error|Exception)$/.test(name);
}

/**
 * True when the `new` expression already carries a cause — an argument object
 * with a `cause` property, or any spread the rule cannot see through (treated as
 * a possible cause so hand-written code is never flagged).
 */
function alreadyHasCause(node: TSESTree.NewExpression): boolean {
  for (const arg of node.arguments) {
    if (arg.type === AST_NODE_TYPES.SpreadElement) {
      return true;
    }
    if (arg.type === AST_NODE_TYPES.ObjectExpression) {
      for (const prop of arg.properties) {
        if (prop.type === AST_NODE_TYPES.SpreadElement) {
          return true;
        }
        const key = prop.key;
        const isCause =
          (key.type === AST_NODE_TYPES.Identifier && key.name === 'cause') ||
          (key.type === AST_NODE_TYPES.Literal && key.value === 'cause');
        if (isCause) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The fix that attaches `{ cause: <binding> }`. Returns null when the shape is
 * one we decline to rewrite (a zero-argument `new SomeError()`, where inserting
 * an options object as the first argument could clobber a positional message).
 */
function buildFix(
  node: TSESTree.NewExpression,
  binding: string,
): TSESLint.ReportFixFunction | null {
  const args = node.arguments;
  if (args.length === 0) {
    return null;
  }
  const last = args[args.length - 1];
  if (last === undefined) {
    return null;
  }
  if (last.type === AST_NODE_TYPES.ObjectExpression) {
    const props = last.properties;
    if (props.length === 0) {
      return (fixer) => fixer.replaceText(last, `{ cause: ${binding} }`);
    }
    const lastProp = props[props.length - 1];
    if (lastProp === undefined) {
      return null;
    }
    return (fixer) => fixer.insertTextAfter(lastProp, `, cause: ${binding}`);
  }
  return (fixer) => fixer.insertTextAfter(last, `, { cause: ${binding} }`);
}

export const requireErrorCauseRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require re-thrown errors inside a `catch` to forward the caught error as `{ cause }`. A `throw new SomeError(...)` that omits the cause severs the chain to the original failure.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      missingCause:
        'Re-throwing inside `catch` without `{ cause: {{binding}} }` drops the original error. Pass `{ cause: {{binding}} }` to `new {{ctor}}(...)` so the chain is preserved.',
    },
  },
  defaultOptions: [],
  create(context) {
    // Nearest enclosing catch binding: the identifier name, or null when the
    // catch has no usable single-identifier binding (`catch {}` / destructured).
    const catchBindings: (string | null)[] = [];

    return {
      CatchClause(node): void {
        const param = node.param;
        catchBindings.push(
          param && param.type === AST_NODE_TYPES.Identifier ? param.name : null,
        );
      },
      'CatchClause:exit'(): void {
        catchBindings.pop();
      },
      ThrowStatement(node): void {
        const binding = catchBindings[catchBindings.length - 1];
        if (binding == null) {
          return;
        }
        const arg = node.argument;
        if (arg.type !== AST_NODE_TYPES.NewExpression) {
          return;
        }
        const ctor = constructorSimpleName(arg);
        if (ctor === null || !isErrorLikeName(ctor)) {
          return;
        }
        if (alreadyHasCause(arg)) {
          return;
        }
        const fix = buildFix(arg, binding);
        context.report({
          node: arg,
          messageId: 'missingCause',
          data: { binding, ctor },
          ...(fix ? { fix } : {}),
        });
      },
    };
  },
});
