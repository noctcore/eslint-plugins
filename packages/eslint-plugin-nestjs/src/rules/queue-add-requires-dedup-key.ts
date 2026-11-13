import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  bulkJobs,
  isUndefined,
  propertyName,
  queueMethod,
  queuePatternRegExp,
  queuePatternSchema,
} from '../utils/queue';

const RULE_NAME = 'queue-add-requires-dedup-key';

export interface QueueAddRequiresDedupKeyOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue. */
  readonly queuePattern?: string;
}

type RuleOptions = [QueueAddRequiresDedupKeyOptions];
type MessageIds = 'missingKey' | 'optionsNotLiteral' | 'jobsNotLiteral';

/** The job options that make a producer retry land on the job it already made. */
const DEDUP_KEYS = new Set(['jobId', 'deduplication']);

/** A direct `jobId` / `deduplication` property whose value is not `undefined`. */
function isDedupKey(member: TSESTree.ObjectLiteralElement): boolean {
  if (member.type !== AST_NODE_TYPES.Property) return false;
  const name = propertyName(member);
  if (name === null || !DEDUP_KEYS.has(name)) return false;
  return !isUndefined(member.value);
}

/** The object literal a spread branch evaluates to, or null for any other shape. */
function branchObject(node: TSESTree.Node): TSESTree.ObjectExpression | null {
  return node.type === AST_NODE_TYPES.ObjectExpression ? node : null;
}

/**
 * Whether an options object literal names a dedup key: as a direct property,
 * or inside a spread written as the visible conditional,
 * `...(jobId ? { jobId } : {})` or `...(jobId && { jobId })`: "this producer
 * keys its job only when it has something to key it on". A key that is
 * `undefined`, one nested deeper, or one inside a call is not a key.
 */
function carriesDedupKey(options: TSESTree.ObjectExpression): boolean {
  return options.properties.some((member) => {
    if (member.type !== AST_NODE_TYPES.SpreadElement) return isDedupKey(member);
    const argument = member.argument;
    let branches: TSESTree.Node[] = [];
    if (argument.type === AST_NODE_TYPES.ConditionalExpression) {
      branches = [argument.consequent, argument.alternate];
    } else if (argument.type === AST_NODE_TYPES.LogicalExpression && argument.operator === '&&') {
      branches = [argument.right];
    }
    return branches.some((branch) => branchObject(branch)?.properties.some(isDedupKey) ?? false);
  });
}

/*
 * Every job a producer enqueues names its dedup key: `jobId` (a deterministic
 * key, or `randomUUID()` as the explicit "every call is a new job") or BullMQ
 * `deduplication`. Without one, a producer retry (a double submit, a replayed
 * request, a sweep re-run) enqueues the same work twice. The options must be an
 * object literal at the call, so the key is visible where the job is made: an
 * options object built elsewhere and passed by name is refused rather than
 * followed.
 */
export const queueAddRequiresDedupKeyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every BullMQ `.add` / `.addBulk` job to carry a `jobId` or `deduplication` in literal options, so a producer retry cannot enqueue the same work twice.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queuePattern: queuePatternSchema,
        },
      },
    ],
    messages: {
      missingKey:
        'Give this job a dedup key: `jobId` (deterministic, or `randomUUID()` for "always a new job") or `deduplication`. Without one a retried producer enqueues the same work twice.',
      optionsNotLiteral:
        'Write the job options as an object literal here, so its dedup key is visible where the job is made.',
      jobsNotLiteral:
        'Build the `addBulk` jobs as object literals (`{ name, data, opts: { jobId } }`) here, so every dedup key is visible.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const pattern = queuePatternRegExp(options.queuePattern);
    const visitorKeys = context.sourceCode.visitorKeys;

    function checkOptions(opts: TSESTree.Node | undefined, reportOn: TSESTree.Node): void {
      if (opts === undefined) {
        context.report({ node: reportOn, messageId: 'missingKey' });
      } else if (opts.type !== AST_NODE_TYPES.ObjectExpression) {
        context.report({ node: opts, messageId: 'optionsNotLiteral' });
      } else if (!carriesDedupKey(opts)) {
        context.report({ node: opts, messageId: 'missingKey' });
      }
    }

    return {
      CallExpression(node): void {
        const method = queueMethod(node, pattern);
        if (method === 'add') {
          checkOptions(node.arguments[2], node);
          return;
        }
        if (method !== 'addBulk') return;

        const [argument] = node.arguments;
        const jobs = argument === undefined ? [] : bulkJobs(argument, visitorKeys);
        if (jobs.length === 0) {
          context.report({ node, messageId: 'jobsNotLiteral' });
          return;
        }
        for (const job of jobs) {
          const opts = job.properties.find(
            (property): property is TSESTree.Property =>
              property.type === AST_NODE_TYPES.Property && propertyName(property) === 'opts',
          );
          checkOptions(opts?.value, job);
        }
      },
    };
  },
});
