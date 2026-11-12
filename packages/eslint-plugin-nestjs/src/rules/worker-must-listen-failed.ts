import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  bindingKey,
  eventName,
  isBullmqNew,
  listenerChain,
  onCallReceiver,
  workerBinding,
} from '../utils/bullmq';

const RULE_NAME = 'worker-must-listen-failed';

const DEFAULT_REQUIRED_EVENTS: readonly string[] = ['failed'];

export interface WorkerMustListenFailedOptions {
  /** Events every worker must have a `.on(...)` listener for. Default `['failed']`. */
  readonly requiredEvents?: readonly string[];
}

type RuleOptions = [WorkerMustListenFailedOptions];
type MessageIds = 'missingListener' | 'unboundWorker';

interface BoundWorker {
  readonly node: TSESTree.NewExpression;
  readonly key: string;
  readonly missing: readonly string[];
}

function quoteEvents(events: readonly string[]): string {
  return events.map((event) => `'${event}'`).join(', ');
}

/**
 * The receiver a `.on(...)` call is ultimately made on: `w` for
 * `w.on('completed', a).on('failed', b)`, since each `on` returns the worker.
 */
function listenerRoot(node: TSESTree.CallExpression): TSESTree.Expression | null {
  let receiver = onCallReceiver(node);
  while (receiver?.type === AST_NODE_TYPES.CallExpression) {
    const inner = onCallReceiver(receiver);
    if (inner === null) break;
    receiver = inner;
  }
  return receiver;
}

/*
 * A BullMQ worker that nobody listens to fails in silence: a job that throws
 * is moved to the failed set, retried or not, and nothing in the logs says so.
 * Every `new Worker(...)` imported from `bullmq` must have a `.on('failed', ...)`
 * somewhere in the same file, chained on the constructor or attached through
 * the name it is bound to. A worker handed to a caller or another function is
 * left alone, since the listener can be attached there.
 */
export const workerMustListenFailedRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require every BullMQ `new Worker(...)` to have a `.on('failed', ...)` listener in the same file, so a failing job is not silent.",
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          requiredEvents: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
            minItems: 1,
            description:
              "Worker events that each need a `.on(event, ...)` listener, for example `['failed', 'error']`. Replaces the default `['failed']`.",
          },
        },
      },
    ],
    messages: {
      missingListener:
        'BullMQ worker `{{name}}` has no listener for {{events}} in this file, so a failing job goes unnoticed. Add `{{name}}.on(...)` for each.',
      unboundWorker:
        "This BullMQ worker is not bound to a name, so nothing can listen for {{events}} on it. Bind it, or chain `.on('failed', ...)` on the constructor.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const required = options.requiredEvents ?? DEFAULT_REQUIRED_EVENTS;
    const bound: BoundWorker[] = [];
    const heard = new Map<string, Set<string>>();
    const escaped = new Set<string>();

    function markEscaped(node: TSESTree.Node | null | undefined): void {
      if (node === null || node === undefined) return;
      const key = bindingKey(node);
      if (key !== null) escaped.add(key);
    }

    return {
      NewExpression(node): void {
        for (const argument of node.arguments) markEscaped(argument);
        if (!isBullmqNew(node, 'Worker', context.sourceCode.getScope(node))) return;
        const chain = listenerChain(node);
        const missing = required.filter((event) => !chain.events.includes(event));
        if (missing.length === 0) return;
        const binding = workerBinding(chain.top);
        if (binding.kind === 'bound') {
          bound.push({ node, key: binding.key, missing });
        } else if (binding.kind === 'bare') {
          context.report({ node, messageId: 'unboundWorker', data: { events: quoteEvents(missing) } });
        }
      },
      CallExpression(node): void {
        for (const argument of node.arguments) markEscaped(argument);
        const root = listenerRoot(node);
        const key = root === null ? null : bindingKey(root);
        const event = eventName(node.arguments[0]);
        if (key === null || event === null) return;
        const events = heard.get(key) ?? new Set<string>();
        events.add(event);
        heard.set(key, events);
      },
      ReturnStatement(node): void {
        markEscaped(node.argument);
      },
      ArrowFunctionExpression(node): void {
        if (node.expression) markEscaped(node.body);
      },
      VariableDeclarator(node): void {
        markEscaped(node.init);
      },
      AssignmentExpression(node): void {
        markEscaped(node.right);
      },
      Property(node): void {
        if (node.parent.type === AST_NODE_TYPES.ObjectExpression) markEscaped(node.value);
      },
      ArrayExpression(node): void {
        for (const element of node.elements) markEscaped(element);
      },
      'Program:exit'(): void {
        for (const worker of bound) {
          if (escaped.has(worker.key)) continue;
          const events = heard.get(worker.key);
          const missing = worker.missing.filter((event) => events?.has(event) !== true);
          if (missing.length === 0) continue;
          context.report({
            node: worker.node,
            messageId: 'missingListener',
            data: { name: worker.key, events: quoteEvents(missing) },
          });
        }
      },
    };
  },
});
