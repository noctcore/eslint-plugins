import { fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { bullmqImportName } from '../utils/bullmq';
import { allowInSchema, isImportOf, methodCall, NEST_BULLMQ_MODULE, usesJobs } from '../utils/jobs';

const RULE_NAME = 'queue-registration-through-define-queue';

export interface QueueRegistrationThroughDefineQueueOptions {
  /** Globs of files the rule skips, such as tests that drive BullMQ directly. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [QueueRegistrationThroughDefineQueueOptions];
type MessageIds = 'handBuilt' | 'registerQueue';

/** The bullmq classes that build a queue's Redis side by hand. */
const HAND_BUILT: ReadonlySet<string> = new Set(['Queue', 'Worker', 'QueueEvents']);

/** The `BullModule` methods that register a queue. */
const REGISTER_METHODS: ReadonlySet<string> = new Set(['registerQueue', 'registerQueueAsync']);

/*
 * In an app that uses `@noctcore/jobs`, a queue is defined once with
 * `defineQueue(name, policy)` and registered with `JobsModule.forFeature`,
 * and the runtime builds its BullMQ queue and worker. A hand-built
 * `new Queue(...)`, `new Worker(...)` or `new QueueEvents(...)` from `bullmq`,
 * or a `BullModule.registerQueue(...)` from `@nestjs/bullmq`, gets none of the
 * policy (attempts, jittered backoff, bounded retention) and none of the
 * producer and worker connection split, so a single attempt and job sets that
 * grow forever come back without a sign.
 *
 * "Uses `@noctcore/jobs`" means the file imports it, or a `package.json` from
 * the file's directory up to the workspace root declares it.
 */
export const queueRegistrationThroughDefineQueueRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report BullMQ queues, workers and queue events built by hand (`new Queue(...)`, `BullModule.registerQueue(...)`) in apps that use `@noctcore/jobs`, where queues come from `defineQueue` and `JobsModule.forFeature`.',
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
      handBuilt:
        'Define this queue with `defineQueue(name, policy)` and register it with `JobsModule.forFeature`. A hand-built BullMQ `{{name}}` gets none of the policy (attempts, backoff, retention) and none of the producer and worker connection split.',
      registerQueue:
        'Define this queue with `defineQueue(name, policy)` and register it with `JobsModule.forFeature`. `BullModule.{{name}}` builds a queue with BullMQ defaults: one attempt and finished jobs kept forever.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const allowIn = resolveAllowIn(options, [], []);
    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd) || !usesJobs(context)) return {};
    const sourceCode = context.sourceCode;

    return {
      NewExpression(node): void {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return;
        const name = bullmqImportName(node.callee, sourceCode.getScope(node));
        if (name !== null && HAND_BUILT.has(name)) {
          context.report({ node, messageId: 'handBuilt', data: { name } });
        }
      },
      CallExpression(node): void {
        const call = methodCall(node);
        if (
          call !== null &&
          REGISTER_METHODS.has(call.method) &&
          isImportOf(call.receiver, NEST_BULLMQ_MODULE, 'BullModule', sourceCode)
        ) {
          context.report({ node, messageId: 'registerQueue', data: { name: call.method } });
        }
      },
    };
  },
});
