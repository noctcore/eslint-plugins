import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { DEFAULT_LOGGERS, loggerCallMethod } from '../utils';

const RULE_NAME = 'structured-log-arguments';

export interface StructuredLogArgumentsOptions {
  readonly loggers?: readonly string[];
}

type RuleOptions = [StructuredLogArgumentsOptions];
type MessageIds = 'interpolatedMessage';

/*
 * The structured-logging discipline. Dynamic values baked into a log MESSAGE
 * string — `logger.info(`processing task ${taskId}`)` — are unqueryable: a log
 * aggregator can't index, filter, or alert on `taskId` when it is fused into free
 * text. The value belongs in a structured context object:
 * `logger.info('processing task', { taskId })`.
 *
 * Matched purely structurally (no type info): a `<logger>.<method>(...)` call
 * (see `../utils`) that receives a template literal WITH expressions as a DIRECT
 * positional argument. Only direct arguments are inspected — a template literal
 * nested inside a context object (`{ url: `${base}/x` }`) is legitimately building
 * a value, not the message, so it is never flagged. A static template with no
 * expressions (`logger.info(`ready`)`) carries no dynamic value and is ignored.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    loggers: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

export const structuredLogArgumentsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A logger call must not interpolate dynamic values into the message string (a template literal with expressions). Pass a static message and a structured context object instead.',
    },
    schema: [optionSchema],
    messages: {
      interpolatedMessage:
        'This `.{{method}}(...)` call interpolates dynamic values into the message string — they become unqueryable free text. Pass a static message plus a structured context object (e.g. `log.{{method}}(\'processing task\', { taskId })`) so each field stays indexable.',
    },
  },
  defaultOptions: [{ loggers: DEFAULT_LOGGERS }],
  create(context, [options]) {
    const loggers = new Set(options.loggers ?? DEFAULT_LOGGERS);

    return {
      CallExpression(node): void {
        const method = loggerCallMethod(node, loggers);
        if (method === null) {
          return;
        }
        for (const arg of node.arguments) {
          if (
            arg.type === AST_NODE_TYPES.TemplateLiteral &&
            arg.expressions.length > 0
          ) {
            context.report({
              node: arg,
              messageId: 'interpolatedMessage',
              data: { method },
            });
          }
        }
      },
    };
  },
});
