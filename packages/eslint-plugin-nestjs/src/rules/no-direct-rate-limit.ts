import { fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { bullmqImportName } from '../utils/bullmq';
import { allowInSchema, createReceiverIndex, methodCall, usesJobs } from '../utils/jobs';

const RULE_NAME = 'no-direct-rate-limit';

export interface NoDirectRateLimitOptions {
  /** Globs of files the rule skips. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoDirectRateLimitOptions];
type MessageIds = 'rateLimitCall' | 'rateLimitError';

/*
 * In an app that uses `@noctcore/jobs`, a queue is paused through its one
 * `QueuePause`: `throw await this.pauseQueue(ms)` in a `JobHost`, or
 * `queue.pauseFor(ms)` on a `JobQueue`. BullMQ's `rateLimit(ms)` replaces the
 * pause key with the new expiry, so a one-second pause for a burst cuts short
 * the fifteen-minute pause another replica set for a spent quota. `QueuePause`
 * reads what is left first and only ever makes a pause longer.
 *
 * Reported: `.rateLimit(...)` on `x.bull` and on a receiver the file shows to
 * be a BullMQ queue or worker (built with `new Queue(...)` or
 * `new Worker(...)`, injected with `@InjectQueue` from `@nestjs/bullmq`,
 * annotated `Queue` or `Worker` from `bullmq`, or `this.worker` in a class
 * extending NestJS's `WorkerHost`), and `Worker.RateLimitError()` or
 * `new RateLimitError()` from `bullmq`, the error that hands the job back
 * after a raw `rateLimit`.
 */
export const noDirectRateLimitRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report BullMQ `rateLimit()` calls and `Worker.RateLimitError()` in apps that use `@noctcore/jobs`, where `pauseQueue` / `pauseFor` never shorten a longer pause.',
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
      rateLimitCall:
        'Pause through the queue\'s `QueuePause`: `throw await this.pauseQueue(ms)` in a `JobHost`, or `queue.pauseFor(ms)`. A raw `rateLimit(ms)` replaces the pause, so a short one cuts a longer one another replica set.',
      rateLimitError:
        'Hand the job back with `throw await this.pauseQueue(ms)` in a `JobHost`. The BullMQ rate limit error belongs with a raw `rateLimit(ms)`, which can cut a longer pause short.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const allowIn = resolveAllowIn(options, [], []);
    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd) || !usesJobs(context)) return {};
    const sourceCode = context.sourceCode;
    const index = createReceiverIndex(sourceCode);
    const calls: { readonly node: TSESTree.CallExpression; readonly receiver: TSESTree.Node }[] = [];

    /** True for the bullmq `RateLimitError` class, or `Worker.RateLimitError` on the bullmq `Worker`. */
    function isRateLimitError(callee: TSESTree.Node): boolean {
      if (callee.type === AST_NODE_TYPES.Identifier) {
        return bullmqImportName(callee, sourceCode.getScope(callee)) === 'RateLimitError';
      }
      return (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier &&
        callee.property.name === 'RateLimitError' &&
        callee.object.type === AST_NODE_TYPES.Identifier &&
        bullmqImportName(callee.object, sourceCode.getScope(callee.object)) === 'Worker'
      );
    }

    function checkError(node: TSESTree.CallExpression | TSESTree.NewExpression): void {
      if (isRateLimitError(node.callee)) context.report({ node, messageId: 'rateLimitError' });
    }

    return {
      NewExpression(node): void {
        index.record(node);
        checkError(node);
      },
      CallExpression(node): void {
        checkError(node);
        const call = methodCall(node);
        if (call?.method === 'rateLimit') calls.push({ node, receiver: call.receiver });
      },
      'Program:exit'(): void {
        for (const { node, receiver } of calls) {
          const kind = index.kind(receiver);
          if (kind === 'bullmqQueue' || kind === 'bullmqWorker') {
            context.report({ node, messageId: 'rateLimitCall' });
          }
        }
      },
    };
  },
});
