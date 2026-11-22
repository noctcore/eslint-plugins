import { fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import type { TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { allowInSchema, createReceiverIndex, methodCall, usesJobs } from '../utils/jobs';

const RULE_NAME = 'no-raw-bullmq-queue-add';

export interface NoRawBullmqQueueAddOptions {
  /** Globs of files the rule skips, such as seed scripts. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoRawBullmqQueueAddOptions];
type MessageIds = 'rawAdd';

const ADD_METHODS: ReadonlySet<string> = new Set(['add', 'addBulk']);

/*
 * In an app that uses `@noctcore/jobs`, jobs are enqueued through a
 * `JobQueue`'s `add()`, never through a BullMQ `Queue` directly. A raw add
 * skips what `JobQueue.add()` does on every call: the job context envelope
 * (the worker's logs and spans lose their parent request), dedupe through
 * hashed keys instead of a caller-built `jobId`, and the fail-fast guard that
 * rejects at once while Redis is down instead of hanging the caller.
 *
 * Reported: `.add()` and `.addBulk()` on `x.bull` (a `JobQueue`'s underlying
 * queue) and on a receiver the file shows to be a BullMQ queue: built with
 * `new Queue(...)` from `bullmq`, injected with `@InjectQueue` from
 * `@nestjs/bullmq`, or annotated `Queue` from `bullmq`. A receiver the file
 * says nothing about is left alone.
 */
export const noRawBullmqQueueAddRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report `.add()` / `.addBulk()` on a BullMQ `Queue` (`queue.bull` included) in apps that use `@noctcore/jobs`, which skip its context envelope, dedupe and fail-fast enqueue.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: allowInSchema,
        },
      },
    ],
    messages: {
      rawAdd:
        'Enqueue through the `JobQueue` (`@InjectQueue(queue)`) with `add(name, data, { dedupe })`. A raw BullMQ `{{method}}` skips the job context envelope, hashed dedupe keys and the fail-fast guard, so an outage hangs the caller.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const allowIn = resolveAllowIn(options, [], []);
    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd) || !usesJobs(context)) return {};
    const index = createReceiverIndex(context.sourceCode);
    const calls: { readonly node: TSESTree.CallExpression; readonly receiver: TSESTree.Node; readonly method: string }[] =
      [];

    return {
      NewExpression(node): void {
        index.record(node);
      },
      CallExpression(node): void {
        const call = methodCall(node);
        if (call !== null && ADD_METHODS.has(call.method)) calls.push({ node, ...call });
      },
      'Program:exit'(): void {
        for (const { node, receiver, method } of calls) {
          if (index.kind(receiver) === 'bullmqQueue') {
            context.report({ node, messageId: 'rawAdd', data: { method } });
          }
        }
      },
    };
  },
});
