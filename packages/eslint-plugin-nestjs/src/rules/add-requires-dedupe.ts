import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { jobOptionsLiteral } from '../utils/bullmq';
import { createReceiverIndex, fileImports, isJobQueueReceiver, JOBS_MODULE, methodCall } from '../utils/jobs';
import { directProperty, isUndefined, queuePatternRegExp, queuePatternSchema } from '../utils/queue';

const RULE_NAME = 'add-requires-dedupe';

export interface AddRequiresDedupeOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue when the file does not say. */
  readonly queuePattern?: string;
}

type RuleOptions = [AddRequiresDedupeOptions];
type MessageIds = 'missingDedupe' | 'rawKey';

/** BullMQ's own dedupe options, which a `JobQueue` never passes on. */
const RAW_KEYS: readonly string[] = ['jobId', 'deduplication'];

/*
 * Every `add()` on a `@noctcore/jobs` queue passes `{ dedupe: ... }`, one of
 * `dedupe.window`, `until`, `debounce` or `none`. The types require it on a
 * typed queue; this covers JavaScript callers and queues typed as `any`. With
 * no `dedupe` the call throws when the job is built, and a `jobId` or
 * `deduplication` passed instead is dropped without a word, so a caller who
 * meant to dedupe gets a new job every time.
 *
 * Only an options object literal is read: options built elsewhere, or a
 * literal with a spread that may carry `dedupe`, are left alone. Only files
 * that import `@noctcore/jobs` are checked, and receivers are read like the
 * other jobs rules read them (a `JobQueue` the file shows, else a name
 * matching `queuePattern`, never a BullMQ queue such as `queue.bull`).
 */
export const addRequiresDedupeRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every `add()` on a `@noctcore/jobs` queue to pass an explicit `dedupe` choice, and report a raw `jobId` or `deduplication` in its options.',
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
      missingDedupe:
        'Pass `{ dedupe: ... }`: `dedupe.window(key, ttl)`, `dedupe.until(key)`, `dedupe.debounce(key, wait)` or `dedupe.none()`. Without it `add()` throws when it builds the job.',
      rawKey:
        '`{{key}}` is not a `JobQueue` option and is dropped, so this job is never deduped. Use `dedupe.window(key, ttl)`, `dedupe.until(key)` or `dedupe.debounce(key, wait)`.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const sourceCode = context.sourceCode;
    if (!fileImports(sourceCode, JOBS_MODULE)) return {};
    const pattern = queuePatternRegExp(options.queuePattern);
    const index = createReceiverIndex(sourceCode);
    const adds: { readonly node: TSESTree.CallExpression; readonly receiver: TSESTree.Node }[] = [];

    function check(node: TSESTree.CallExpression): void {
      const argument = node.arguments[2];
      if (argument === undefined) {
        if (!node.arguments.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) {
          context.report({ node, messageId: 'missingDedupe' });
        }
        return;
      }
      const opts = jobOptionsLiteral(argument);
      if (opts === null) return;
      for (const key of RAW_KEYS) {
        const property = directProperty(opts, key);
        if (property !== undefined && !isUndefined(property.value)) {
          context.report({ node: property, messageId: 'rawKey', data: { key } });
        }
      }
      const dedupe = directProperty(opts, 'dedupe');
      if (dedupe !== undefined && !isUndefined(dedupe.value)) return;
      if (opts.properties.some((member) => member.type === AST_NODE_TYPES.SpreadElement)) return;
      context.report({ node: opts, messageId: 'missingDedupe' });
    }

    return {
      NewExpression(node): void {
        index.record(node);
      },
      CallExpression(node): void {
        const call = methodCall(node);
        // `add(name, data, ...)`: a one-argument `add` (a set, a task queue) is something else.
        if (call?.method === 'add' && node.arguments.length >= 2) adds.push({ node, receiver: call.receiver });
      },
      'Program:exit'(): void {
        for (const { node, receiver } of adds) {
          if (isJobQueueReceiver(receiver, index, pattern)) check(node);
        }
      },
    };
  },
});
