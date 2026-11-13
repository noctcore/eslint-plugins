import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  decoratorCallName,
  queueMethod,
  queuePatternRegExp,
  queuePatternSchema,
} from '../utils/queue';

const RULE_NAME = 'job-name-must-be-constant';

export interface JobNameMustBeConstantOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue. */
  readonly queuePattern?: string;
  /** Decorators whose first argument is a queue name. */
  readonly decorators?: readonly string[];
}

type RuleOptions = [JobNameMustBeConstantOptions];
type MessageIds = 'mustBeConstant';

const DEFAULT_DECORATORS: readonly string[] = ['Processor', 'InjectQueue'];

/** A string literal or a template literal with no substitutions. */
function isInlineName(node: TSESTree.Node | undefined): node is TSESTree.Expression {
  if (node === undefined) return false;
  if (node.type === AST_NODE_TYPES.Literal) return typeof node.value === 'string';
  return node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0;
}

/*
 * Queue and job names are constants shared by producer and worker, not inline
 * string literals, so a typo cannot silently create a second queue or a job no
 * worker handles. Checked: the first argument of `@Processor(...)` and
 * `@InjectQueue(...)` (the queue name) and of `<queue>.add(...)` (the job
 * name). An identifier or member access (the constant) passes; a string literal
 * or a substitution-free template literal is reported. Report-only: there is
 * no literal-to-constant map to fix from.
 */
export const jobNameMustBeConstantRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require queue and job names passed to `@Processor(...)`, `@InjectQueue(...)` and `<queue>.add(...)` to be shared constants, not inline string literals.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queuePattern: queuePatternSchema,
          decorators: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Decorators whose first argument is a queue name. Default `["Processor", "InjectQueue"]`.',
          },
        },
      },
    ],
    messages: {
      mustBeConstant:
        'Use a shared constant for this {{what}} name, not an inline string: producer and worker must agree on it, and a typo here creates a queue or job nothing handles.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const pattern = queuePatternRegExp(options.queuePattern);
    const decorators = new Set(options.decorators ?? DEFAULT_DECORATORS);

    return {
      Decorator(node): void {
        const name = decoratorCallName(node);
        if (name === null || !decorators.has(name)) return;
        const call = node.expression as TSESTree.CallExpression;
        const [argument] = call.arguments;
        if (isInlineName(argument)) {
          context.report({ node: argument, messageId: 'mustBeConstant', data: { what: 'queue' } });
        }
      },
      CallExpression(node): void {
        if (queueMethod(node, pattern) !== 'add') return;
        const [argument] = node.arguments;
        if (isInlineName(argument)) {
          context.report({ node: argument, messageId: 'mustBeConstant', data: { what: 'job' } });
        }
      },
    };
  },
});
