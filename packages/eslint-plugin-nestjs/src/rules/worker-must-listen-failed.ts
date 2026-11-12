import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  ANY_EVENT,
  classChain,
  type ClassNode,
  createBindingResolver,
  isBullmqNew,
  listenerChain,
  listenerEvent,
  listenerReceiver,
  stripTypeWrappers,
  workerBinding,
  type BindingRef,
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
  readonly refs: readonly BindingRef[];
  readonly missing: readonly string[];
}

function quoteEvents(events: readonly string[]): string {
  return events.map((event) => `'${event}'`).join(', ');
}

/**
 * The receiver a listener call is ultimately made on: `w` for
 * `w.on('completed', a).on('failed', b)`, since each `on` returns the worker.
 */
function listenerRoot(node: TSESTree.CallExpression): TSESTree.Expression | null {
  let receiver = listenerReceiver(node);
  while (receiver !== null) {
    const inner = stripTypeWrappers(receiver);
    if (inner.type !== AST_NODE_TYPES.CallExpression) break;
    const next = listenerReceiver(inner);
    if (next === null) break;
    receiver = next;
  }
  return receiver;
}

/*
 * A BullMQ worker that nobody listens to fails in silence: a job that throws
 * is moved to the failed set, retried or not, and nothing in the logs says so.
 * Every `new Worker(...)` imported from `bullmq` must have a `.on('failed', ...)`
 * somewhere in the same file, chained on the constructor or attached through
 * the binding it is stored in. Bindings are resolved through scope, so two
 * workers named `w` in different functions are checked apart. A field is
 * shared along a class hierarchy, so `this.worker` in a base class or a
 * subclass declared in the same file is the same binding; when a base comes
 * from elsewhere it may attach the listener, so a field worker of that class
 * is left alone. A worker handed
 * to a caller, another function or another binding is left alone, since the
 * listener can be attached there, and a listener whose event name is not a
 * static string may be the one for `failed`, so it counts for every event.
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
    const { sourceCode } = context;
    const resolver = createBindingResolver(sourceCode);
    const bound: BoundWorker[] = [];
    const heard = new Map<string, Set<string>>();
    const heardAny = new Set<string>();
    const escaped = new Set<string>();
    const classes: ClassNode[] = [];

    function recordClass(node: ClassNode): void {
      classes.push(node);
    }

    /**
     * Every key `ref` is known by: itself, and for a `this` binding the same
     * member path on each class of its hierarchy declared in this file. Null
     * when the hierarchy has a base from elsewhere, which may listen unseen.
     */
    function keysOf(ref: BindingRef): readonly string[] | null {
      if (ref.owner === undefined) return [ref.key];
      const chain = classChain(ref.owner, sourceCode);
      if (!chain.complete) return null;
      const owner = ref.owner;
      const related = new Set<ClassNode>(chain.classes);
      for (const other of classes) {
        if (classChain(other, sourceCode).classes.includes(owner)) related.add(other);
      }
      const keys = new Set<string>([ref.key]);
      for (const member of related) {
        const key = resolver.keyIn(ref, member);
        if (key !== null) keys.add(key);
      }
      return [...keys];
    }

    function markEscaped(node: TSESTree.Node | null | undefined): void {
      if (node === null || node === undefined) return;
      const ref = resolver.ref(node);
      if (ref !== null) escaped.add(ref.key);
    }

    function hears(keys: readonly string[], event: string): boolean {
      return keys.some((key) => heard.get(key)?.has(event) === true);
    }

    return {
      NewExpression(node): void {
        for (const argument of node.arguments) markEscaped(argument);
        if (!isBullmqNew(node, 'Worker', sourceCode.getScope(node))) return;
        const chain = listenerChain(node);
        const events = chain.calls.map((call) => listenerEvent(call.arguments[0], sourceCode.getScope(call)));
        if (events.includes(ANY_EVENT)) return;
        const missing = required.filter((event) => !events.includes(event));
        if (missing.length === 0) return;
        const binding = workerBinding(chain.top, resolver);
        if (binding.kind === 'bound') {
          bound.push({ node, refs: binding.refs, missing });
        } else if (binding.kind === 'bare') {
          context.report({ node, messageId: 'unboundWorker', data: { events: quoteEvents(missing) } });
        }
      },
      CallExpression(node): void {
        for (const argument of node.arguments) markEscaped(argument);
        const root = listenerRoot(node);
        const ref = root === null ? null : resolver.ref(root);
        if (ref === null) return;
        const event = listenerEvent(node.arguments[0], sourceCode.getScope(node));
        if (event === null) return;
        if (event === ANY_EVENT) {
          heardAny.add(ref.key);
          return;
        }
        const events = heard.get(ref.key) ?? new Set<string>();
        events.add(event);
        heard.set(ref.key, events);
      },
      ReturnStatement(node): void {
        markEscaped(node.argument);
      },
      ArrowFunctionExpression(node): void {
        if (node.expression) markEscaped(node.body);
      },
      VariableDeclarator(node): void {
        markEscaped(node.init);
        if (node.id.type !== AST_NODE_TYPES.ObjectPattern || node.init === null) return;
        const source = resolver.ref(node.init);
        if (source === null) return;
        for (const property of node.id.properties) {
          if (
            property.type === AST_NODE_TYPES.Property &&
            !property.computed &&
            property.key.type === AST_NODE_TYPES.Identifier
          ) {
            escaped.add(resolver.memberRef(source, property.key.name).key);
          }
        }
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
      ClassDeclaration: recordClass,
      ClassExpression: recordClass,
      'Program:exit'(): void {
        for (const worker of bound) {
          const keySets = worker.refs.map(keysOf);
          if (keySets.includes(null)) continue;
          const keys = keySets.flatMap((set) => set ?? []);
          if (keys.some((key) => escaped.has(key) || heardAny.has(key))) continue;
          const missing = worker.missing.filter((event) => !hears(keys, event));
          if (missing.length === 0) continue;
          context.report({
            node: worker.node,
            messageId: 'missingListener',
            data: { name: worker.refs[0]?.name ?? '', events: quoteEvents(missing) },
          });
        }
      },
    };
  },
});
