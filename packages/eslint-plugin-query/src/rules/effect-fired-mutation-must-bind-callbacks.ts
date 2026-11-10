import { isFunctionNode } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeName, staticName } from '../utils/ast';

const RULE_NAME = 'effect-fired-mutation-must-bind-callbacks';

export interface EffectFiredMutationMustBindCallbacksOptions {
  /** Hooks whose callback body counts as "fired from an effect". */
  readonly effectHooks?: readonly string[];
  /** Method names that start a TanStack Query mutation. */
  readonly mutateMethods?: readonly string[];
  /** Option keys that only a live observer would deliver. */
  readonly perCallCallbacks?: readonly string[];
}

type RuleOptions = [EffectFiredMutationMustBindCallbacksOptions];
type MessageIds = 'mustBindToMutation';

/*
 * A mutation fired from an effect must carry its handlers on `useMutation`,
 * never as the second argument to `mutate(...)`.
 *
 * TanStack Query delivers a per-call `mutate(vars, { onSuccess })` handler only
 * while the observer that issued the call still has listeners
 * (MutationObserver gates them on `hasListeners()`); the options passed to
 * `useMutation` run off the mutation itself and survive whatever happens to
 * the observer. An effect-fired call is exactly the case where that difference
 * bites: React StrictMode's second effect pass, a route transition or a
 * back-and-forward all detach the observer before a slow server answers.
 * Because such effects are usually ref-guarded (the request costs something: a
 * rate-limit budget, a single-use token), the second pass fires no replacement
 * call, and the screen holds its loading state forever with the failure path
 * swallowed too.
 *
 * Per-call callbacks are the right tool from a click or a submit handler,
 * where they close over that one interaction, so only the effect-fired case is
 * reported. The check is lexical: a `mutate(vars, { onSuccess })` in a helper
 * that the effect merely calls is not seen.
 */
const DEFAULT_EFFECT_HOOKS: readonly string[] = ['useEffect', 'useLayoutEffect'];
const DEFAULT_MUTATE_METHODS: readonly string[] = ['mutate', 'mutateAsync'];
const DEFAULT_PER_CALL_CALLBACKS: readonly string[] = ['onSuccess', 'onError', 'onSettled'];

/** True when `node` sits inside a function passed as an effect hook's first argument. */
function isInsideEffect(node: TSESTree.Node, effectHooks: ReadonlySet<string>): boolean {
  for (let current = node.parent; current != null; current = current.parent) {
    if (!isFunctionNode(current)) continue;
    const call = current.parent;
    if (
      call?.type === AST_NODE_TYPES.CallExpression &&
      call.arguments[0] === current &&
      effectHooks.has(calleeName(call) ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/** The first per-call callback key in an options object literal, or undefined. */
function perCallCallback(
  node: TSESTree.Node | undefined,
  callbackNames: ReadonlySet<string>,
): string | undefined {
  if (node?.type !== AST_NODE_TYPES.ObjectExpression) return undefined;
  for (const property of node.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const name = staticName(property.key, property.computed);
    if (name !== undefined && callbackNames.has(name)) return name;
  }
  return undefined;
}

export const effectFiredMutationMustBindCallbacksRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a mutation fired from an effect to carry its onSuccess/onError on `useMutation`, not as per-call `mutate()` options, which a detached observer never delivers.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          effectHooks: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Hooks whose callback counts as an effect. Default `["useEffect", "useLayoutEffect"]`.',
          },
          mutateMethods: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description: 'Calls that start a mutation. Default `["mutate", "mutateAsync"]`.',
          },
          perCallCallbacks: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Per-call option keys that only a live observer delivers. Default `["onSuccess", "onError", "onSettled"]`.',
          },
        },
      },
    ],
    messages: {
      mustBindToMutation:
        'Move `{{callback}}` onto the `useMutation({ ... })` options. A per-call `{{method}}(vars, { ... })` handler runs only while the issuing observer still has listeners, so a remount before the server answers drops it and the screen never leaves its loading state.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const effectHooks = new Set(options.effectHooks ?? DEFAULT_EFFECT_HOOKS);
    const mutateMethods = new Set(options.mutateMethods ?? DEFAULT_MUTATE_METHODS);
    const perCallCallbacks = new Set(options.perCallCallbacks ?? DEFAULT_PER_CALL_CALLBACKS);

    return {
      CallExpression(node): void {
        const method = calleeName(node);
        if (method === undefined || !mutateMethods.has(method)) return;
        const perCallOptions = node.arguments[1];
        const callback = perCallCallback(perCallOptions, perCallCallbacks);
        if (callback === undefined || perCallOptions === undefined) return;
        if (!isInsideEffect(node, effectHooks)) return;

        context.report({
          node: perCallOptions,
          messageId: 'mustBindToMutation',
          data: { method, callback },
        });
      },
    };
  },
});
