import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  createBindingResolver,
  createQueueDefaultsIndex,
  jobOptionsLiteral,
  resolveJobOption,
} from '../utils/bullmq';
import { isUndefined, queueMethod, queuePatternRegExp, queuePatternSchema } from '../utils/queue';

const RULE_NAME = 'queue-options-must-set-retention';

type RetentionKey = 'removeOnComplete' | 'removeOnFail';

const RETENTION_KEYS: readonly RetentionKey[] = ['removeOnComplete', 'removeOnFail'];

export interface QueueOptionsMustSetRetentionOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue. */
  readonly queuePattern?: string;
  /** The retention keys every job must state. Default: both. */
  readonly require?: readonly RetentionKey[];
}

type RuleOptions = [QueueOptionsMustSetRetentionOptions];
type MessageIds = 'missingRetention';

function formatKeys(keys: readonly RetentionKey[]): string {
  return keys.map((key) => `\`${key}\``).join(' and ');
}

/*
 * BullMQ keeps every completed and failed job in Redis unless the job or its
 * queue says to remove it, so a busy queue grows without bound. Every job
 * states `removeOnComplete` and `removeOnFail`, in its options or in its
 * queue's `defaultJobOptions`; a literal `false` is a deliberate answer. The
 * queue defaults are read from a bullmq `new Queue(name, { defaultJobOptions })`
 * stored in the binding the call goes through, in the same file; defaults set
 * anywhere else are not visible.
 */
export const queueOptionsMustSetRetentionRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every BullMQ `.add` job to state `removeOnComplete` and `removeOnFail` in its options or its queue\'s `defaultJobOptions`, so finished jobs do not pile up in Redis.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queuePattern: queuePatternSchema,
          require: {
            type: 'array',
            items: { type: 'string', enum: [...RETENTION_KEYS] },
            minItems: 1,
            uniqueItems: true,
            description:
              'The retention keys every job must state, from `removeOnComplete` and `removeOnFail`. Default: both.',
          },
        },
      },
    ],
    messages: {
      missingRetention:
        'Set {{keys}} on this job or in its queue\'s `defaultJobOptions`. Without them BullMQ keeps every finished job in Redis; an explicit `false` is a valid choice.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const pattern = queuePatternRegExp(options.queuePattern);
    const required = options.require ?? RETENTION_KEYS;
    const sourceCode = context.sourceCode;
    const resolver = createBindingResolver(sourceCode);
    const queues = createQueueDefaultsIndex(sourceCode, resolver);
    const pending: { call: TSESTree.CallExpression; receiver: TSESTree.Expression }[] = [];

    function check(
      job: TSESTree.ObjectExpression | undefined,
      defaults: TSESTree.ObjectExpression | null,
      reportOn: TSESTree.Node,
    ): void {
      const missing: RetentionKey[] = [];
      for (const key of required) {
        const resolved = resolveJobOption(key, job, defaults);
        if (resolved.kind === 'unknown') return;
        if (resolved.kind === 'missing') missing.push(key);
      }
      if (missing.length === 0) return;
      context.report({
        node: reportOn,
        messageId: 'missingRetention',
        data: { keys: formatKeys(missing) },
      });
    }

    return {
      NewExpression(node): void {
        queues.record(node);
      },
      CallExpression(node): void {
        if (queueMethod(node, pattern) !== 'add') return;
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (node.arguments.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement)) return;
        pending.push({ call: node, receiver: node.callee.object });
      },
      'Program:exit'(): void {
        for (const { call, receiver } of pending) {
          const queue = queues.lookup(receiver);
          if (queue?.kind === 'unknown') continue;
          const defaults = queue?.options ?? null;
          const [name, , jobOptions] = call.arguments;
          if (call.arguments.length < 2 || name?.type === AST_NODE_TYPES.ObjectExpression) continue;
          if (jobOptions === undefined || isUndefined(jobOptions)) {
            check(undefined, defaults, call);
            continue;
          }
          const literal = jobOptionsLiteral(jobOptions);
          if (literal !== null) check(literal, defaults, literal);
        }
      },
    };
  },
});
