import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { DEFAULT_LOGGERS, loggerCallMethod } from '../utils';

const RULE_NAME = 'no-error-detail-loss';

type MessageIds = 'detailLoss';

/*
 * A caught error carries a stack and often a `cause` — the parts you actually
 * need to debug a production failure. A catch block that logs ONLY `e.message`,
 * `String(e)`, or `${e}` throws that away: the log records that something failed
 * but not where or why.
 *
 * This rule fires only when ALL of these hold, keeping it conservative:
 *  - the catch binding is a plain identifier (`catch (e)`), and
 *  - the block contains a logger call (so failure is actually being reported), and
 *  - the binding IS referenced (an unused binding is a different rule), and
 *  - EVERY reference to the binding is a lossy form — `e.message`, `String(e)`,
 *    or bare `${e}` interpolation.
 * If the error is passed whole anywhere (`log.error('x', e)`, `{ err: e }`), or
 * `.stack` / `.cause` / any other property is read, or it is re-thrown, the
 * diagnostics survive and the rule stays silent.
 */

/** True when the catch body contains at least one logger call. */
function containsLoggerCall(
  block: TSESTree.BlockStatement,
  loggers: ReadonlySet<string>,
): boolean {
  let found = false;
  function walk(node: TSESTree.Node): void {
    if (found) {
      return;
    }
    if (
      node.type === AST_NODE_TYPES.CallExpression &&
      loggerCallMethod(node, loggers) !== null
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
  walk(block);
  return found;
}

/**
 * True when this reference to the error binding discards its diagnostics: it is
 * `e.message`, the argument of `String(e)`, or a bare `${e}` interpolation.
 */
function isLossyReference(id: TSESTree.Identifier): boolean {
  const parent = id.parent;
  // `e.message`
  if (
    parent.type === AST_NODE_TYPES.MemberExpression &&
    parent.object === id &&
    !parent.computed &&
    parent.property.type === AST_NODE_TYPES.Identifier &&
    parent.property.name === 'message'
  ) {
    return true;
  }
  // `String(e)`
  if (
    parent.type === AST_NODE_TYPES.CallExpression &&
    parent.callee.type === AST_NODE_TYPES.Identifier &&
    parent.callee.name === 'String' &&
    parent.arguments.includes(id)
  ) {
    return true;
  }
  // Bare `${e}` — the identifier sits directly in a template literal.
  if (parent.type === AST_NODE_TYPES.TemplateLiteral) {
    return true;
  }
  return false;
}

export const noErrorDetailLossRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A catch block that reports a failure must not reduce the error to only `e.message` / `String(e)` / `${e}` — log the error itself so its stack and cause survive.',
    },
    schema: [],
    messages: {
      detailLoss:
        "This catch logs only the error message — its stack and `cause` are lost. Log the error object itself (e.g. `log.error('...', { err: {{name}} })`) so the failure is diagnosable.",
    },
  },
  defaultOptions: [],
  create(context) {
    const loggers = new Set(DEFAULT_LOGGERS);

    return {
      CatchClause(node): void {
        if (node.param === null || node.param.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        if (!containsLoggerCall(node.body, loggers)) {
          return;
        }

        const [variable] = context.sourceCode.getDeclaredVariables(node);
        if (variable === undefined) {
          return;
        }
        const reads = variable.references.filter((ref) => ref.isRead());
        if (reads.length === 0) {
          return; // Unused binding — a different concern.
        }
        const allLossy = reads.every((ref) =>
          isLossyReference(ref.identifier as TSESTree.Identifier),
        );
        if (!allLossy) {
          return;
        }
        context.report({
          node: node.param,
          messageId: 'detailLoss',
          data: { name: node.param.name },
        });
      },
    };
  },
});
