import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { isBullmqNew, stripTypeWrappers } from '../utils/bullmq';
import { decoratorCallName, directProperty, isUndefined } from '../utils/queue';

const RULE_NAME = 'worker-concurrency';

export interface WorkerConcurrencyOptions {
  /** Whether a worker whose options do not state `concurrency` is also reported. */
  readonly requireExplicit?: boolean;
}

type RuleOptions = [WorkerConcurrencyOptions];
type MessageIds = 'notPositive' | 'notInteger' | 'missingConcurrency';

/** The value of a number literal, or of a unary minus on one; null for anything else. */
function numericLiteralValue(node: TSESTree.Node): number | null {
  const inner = stripTypeWrappers(node);
  if (inner.type === AST_NODE_TYPES.Literal) {
    return typeof inner.value === 'number' ? inner.value : null;
  }
  if (inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '-') {
    const argument = stripTypeWrappers(inner.argument);
    if (argument.type === AST_NODE_TYPES.Literal && typeof argument.value === 'number') {
      return -argument.value;
    }
  }
  return null;
}

/*
 * A BullMQ worker runs one job at a time unless `concurrency` says otherwise,
 * and a literal `concurrency` of 0, a negative number or a fraction is a
 * configuration defect, not a tuning choice. Checked: the options of a
 * `new Worker(name, processor, options)` imported from `bullmq` and the second
 * argument of `@Processor(queue, options)`. Only a number literal (and a unary
 * minus on one) is read; an identifier, member access, call or options passed
 * by name is accepted. With `requireExplicit`, options with no `concurrency`
 * key are reported too, unless a spread may supply it. Report-only: there is
 * no value to fix to.
 */
export const workerConcurrencyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a literal BullMQ worker `concurrency`, on `new Worker(...)` or `@Processor(queue, options)`, to be a positive integer, and with `requireExplicit` require it to be stated.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          requireExplicit: {
            type: 'boolean',
            description:
              'Also report a worker whose options object literal has no `concurrency` key, or that has no options at all. Default `false`.',
          },
        },
      },
    ],
    messages: {
      notPositive:
        'A worker `concurrency` of {{value}} cannot run any job: use a positive integer.',
      notInteger:
        'A worker `concurrency` of {{value}} is not a whole number: use a positive integer.',
      missingConcurrency:
        'State `concurrency` for this worker: leaving it out runs one job at a time without anyone having chosen that.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const requireExplicit = options.requireExplicit ?? false;

    function checkOptions(argument: TSESTree.Node | undefined, reportOn: TSESTree.Node): void {
      if (argument === undefined || isUndefined(argument)) {
        if (requireExplicit) context.report({ node: reportOn, messageId: 'missingConcurrency' });
        return;
      }
      const literal = stripTypeWrappers(argument);
      if (literal.type !== AST_NODE_TYPES.ObjectExpression) return;

      const property = directProperty(literal, 'concurrency');
      if (property === undefined || isUndefined(property.value)) {
        const hasSpread = literal.properties.some(
          (member) => member.type === AST_NODE_TYPES.SpreadElement,
        );
        if (requireExplicit && !hasSpread) {
          context.report({ node: literal, messageId: 'missingConcurrency' });
        }
        return;
      }

      const value = numericLiteralValue(property.value);
      if (value === null) return;
      const data = { value: context.sourceCode.getText(property.value) };
      if (value <= 0) {
        context.report({ node: property.value, messageId: 'notPositive', data });
      } else if (!Number.isInteger(value)) {
        context.report({ node: property.value, messageId: 'notInteger', data });
      }
    }

    function hasSpreadArgument(args: readonly TSESTree.CallExpressionArgument[]): boolean {
      return args.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement);
    }

    return {
      NewExpression(node): void {
        if (!isBullmqNew(node, 'Worker', context.sourceCode.getScope(node))) return;
        if (hasSpreadArgument(node.arguments)) return;
        checkOptions(node.arguments[2], node);
      },
      Decorator(node): void {
        if (decoratorCallName(node) !== 'Processor') return;
        const call = node.expression as TSESTree.CallExpression;
        if (hasSpreadArgument(call.arguments)) return;
        checkOptions(call.arguments[1], node);
      },
    };
  },
});
