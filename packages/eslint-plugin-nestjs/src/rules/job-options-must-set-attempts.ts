import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  bindingKeys,
  createBindingResolver,
  createQueueDefaultsIndex,
  isBullmqNew,
  listenerChain,
  stripTypeWrappers,
  workerBinding,
  type QueueDefaults,
} from '../utils/bullmq';
import {
  bulkJobs,
  directProperty,
  isUndefined,
  queueMethod,
  queuePatternRegExp,
  queuePatternSchema,
} from '../utils/queue';

const RULE_NAME = 'job-options-must-set-attempts';

export interface JobOptionsMustSetAttemptsOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue. */
  readonly queuePattern?: string;
  /** Whether a literal `attempts` other than 1 also needs a `backoff`. */
  readonly requireBackoff?: boolean;
}

type RuleOptions = [JobOptionsMustSetAttemptsOptions];
type MessageIds = 'missingAttempts' | 'missingBackoff';

/** How one job option resolves once the call's options are laid over the queue defaults. */
type Resolved =
  | { readonly kind: 'set'; readonly value: TSESTree.Node }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unknown' };

const MISSING: Resolved = { kind: 'missing' };
const UNKNOWN: Resolved = { kind: 'unknown' };

/**
 * `name` in one options literal: a direct key whose value is not `undefined`
 * is set, and a spread may hold the key, so it makes the value unknown.
 */
function keyIn(name: string, options: TSESTree.ObjectExpression): Resolved {
  const property = directProperty(options, name);
  if (property !== undefined && !isUndefined(property.value)) {
    return { kind: 'set', value: property.value };
  }
  return options.properties.some((member) => member.type === AST_NODE_TYPES.SpreadElement)
    ? UNKNOWN
    : MISSING;
}

/** `name` read from the job options first, then from the queue's `defaultJobOptions`. */
function resolveKey(
  name: 'attempts' | 'backoff',
  job: TSESTree.ObjectExpression | undefined,
  defaults: TSESTree.ObjectExpression | null,
): Resolved {
  const own = job === undefined ? MISSING : keyIn(name, job);
  if (own.kind !== 'missing' || defaults === null) return own;
  return keyIn(name, defaults);
}

/** The object literal `node` is once type wrappers are removed, or null. */
function objectLiteral(node: TSESTree.Node): TSESTree.ObjectExpression | null {
  const inner = stripTypeWrappers(node);
  return inner.type === AST_NODE_TYPES.ObjectExpression ? inner : null;
}

/** A job object shaped for a FlowProducer flow: it names its queue or its children. */
function isFlowJob(job: TSESTree.ObjectExpression): boolean {
  return directProperty(job, 'queueName') !== undefined || directProperty(job, 'children') !== undefined;
}

/*
 * Every job a producer enqueues states how often it may run: `attempts` in its
 * options or in its queue's `defaultJobOptions`. BullMQ runs a job once by
 * default, so one transient failure (a timeout, a deploy, a brief outage) loses
 * the job for good. A job that retries also needs a `backoff`, or every retry
 * fires at once into the same outage. The queue defaults are read from a bullmq
 * `new Queue(name, { defaultJobOptions })` stored in the binding the call goes
 * through, in the same file; defaults set anywhere else are not visible.
 */
export const jobOptionsMustSetAttemptsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every BullMQ `.add` / `.addBulk` job to state `attempts`, and a `backoff` when it retries, in its options or its queue\'s `defaultJobOptions`.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queuePattern: queuePatternSchema,
          requireBackoff: {
            type: 'boolean',
            description:
              'When true, a job whose `attempts` is a literal other than 1 must also set `backoff`, in its options or its queue defaults. Default `true`.',
          },
        },
      },
    ],
    messages: {
      missingAttempts:
        'Set `attempts` on this job or in its queue\'s `defaultJobOptions`. BullMQ runs a job once by default, so a single transient failure loses it.',
      missingBackoff:
        'Set a `backoff` for this retrying job, on the job or in its queue\'s `defaultJobOptions`. Without one every retry fires at once, into the same outage.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const pattern = queuePatternRegExp(options.queuePattern);
    const requireBackoff = options.requireBackoff ?? true;
    const sourceCode = context.sourceCode;
    const resolver = createBindingResolver(sourceCode);
    const queues = createQueueDefaultsIndex(sourceCode, resolver);
    const flowKeys = new Set<string>();
    const pending: { call: TSESTree.CallExpression; receiver: TSESTree.Expression; method: string }[] = [];

    function check(
      job: TSESTree.ObjectExpression | undefined,
      queue: QueueDefaults | null,
      reportOn: TSESTree.Node,
    ): void {
      if (queue?.kind === 'unknown') return;
      const defaults = queue?.options ?? null;
      const attempts = resolveKey('attempts', job, defaults);
      if (attempts.kind === 'unknown') return;
      if (attempts.kind === 'missing') {
        context.report({ node: reportOn, messageId: 'missingAttempts' });
        return;
      }
      const value = stripTypeWrappers(attempts.value);
      if (value.type !== AST_NODE_TYPES.Literal || value.value === 1 || !requireBackoff) return;
      if (resolveKey('backoff', job, defaults).kind === 'missing') {
        context.report({ node: reportOn, messageId: 'missingBackoff' });
      }
    }

    function isFlowReceiver(receiver: TSESTree.Expression): boolean {
      const ref = resolver.ref(receiver);
      return ref !== null && bindingKeys(ref, resolver, sourceCode).some((key) => flowKeys.has(key));
    }

    function checkAdd(call: TSESTree.CallExpression, queue: QueueDefaults | null): void {
      const [name, , jobOptions] = call.arguments;
      if (call.arguments.length < 2 || name?.type === AST_NODE_TYPES.ObjectExpression) return;
      if (jobOptions === undefined) {
        check(undefined, queue, call);
        return;
      }
      const literal = objectLiteral(jobOptions);
      if (literal !== null) check(literal, queue, literal);
    }

    function checkAddBulk(call: TSESTree.CallExpression, queue: QueueDefaults | null): void {
      const [argument] = call.arguments;
      if (argument === undefined) return;
      for (const job of bulkJobs(argument, sourceCode.visitorKeys)) {
        if (isFlowJob(job)) continue;
        const opts = directProperty(job, 'opts');
        if (opts === undefined) {
          if (job.properties.some((member) => member.type === AST_NODE_TYPES.SpreadElement)) continue;
          check(undefined, queue, job);
          continue;
        }
        const literal = objectLiteral(opts.value);
        if (literal !== null) check(literal, queue, literal);
      }
    }

    return {
      NewExpression(node): void {
        queues.record(node);
        if (!isBullmqNew(node, 'FlowProducer', sourceCode.getScope(node))) return;
        const binding = workerBinding(listenerChain(node).top, resolver);
        if (binding.kind !== 'bound') return;
        for (const ref of binding.refs) flowKeys.add(ref.key);
      },
      CallExpression(node): void {
        const method = queueMethod(node, pattern);
        if (method !== 'add' && method !== 'addBulk') return;
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (node.arguments.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement)) return;
        pending.push({ call: node, receiver: node.callee.object, method });
      },
      'Program:exit'(): void {
        for (const { call, receiver, method } of pending) {
          if (isFlowReceiver(receiver)) continue;
          const queue = queues.lookup(receiver);
          if (method === 'add') checkAdd(call, queue);
          else checkAddBulk(call, queue);
        }
      },
    };
  },
});
