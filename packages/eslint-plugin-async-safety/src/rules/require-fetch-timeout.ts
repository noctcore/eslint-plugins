import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { calleeText } from '../utils';

const RULE_NAME = 'require-fetch-timeout';

export interface RequireFetchTimeoutOptions {
  readonly callees?: readonly string[];
  readonly defaultTimeoutMs?: number;
}

type RuleOptions = [RequireFetchTimeoutOptions];
type MessageIds = 'missingTimeout' | 'addTimeout';

/*
 * A `fetch(url)` with no cancellation signal can hang forever — the default has
 * no timeout. This flags a matched call (global `fetch`, plus any wrapper named
 * in `callees`, e.g. `undici.request`, `axios`) whose options carry no `signal`
 * and no `timeout`.
 *
 * High-precision syntactic — no types, so it stays silent whenever it cannot SEE
 * the arguments:
 *   - any spread argument (`fetch(url, ...opts)`) → skipped;
 *   - the options slot is an identifier/call/member (`fetch(url, opts)`) → skipped,
 *     because that bag may already set a signal;
 *   - an options object literal with a `...spread` property → skipped;
 *   - the global `fetch` called with a `Request` built in view
 *     (`fetch(new Request(...))`, or a `const` initialised that way) → skipped,
 *     because a `Request` can carry its own signal.
 * The first argument of the global `fetch` is never its options, so `fetch(url)`
 * is reported whatever `url` is. A configured wrapper's single argument may be a
 * config bag (`axios(config)`), so for wrappers only a string/template URL is
 * reported. `timeout` counts only for wrappers: it is not a `fetch` option.
 * The suggestion inserts `signal: AbortSignal.timeout(<default>)`.
 */
const DEFAULT_TIMEOUT_MS = 10000;

const FETCH_SIGNAL_KEYS: ReadonlySet<string> = new Set(['signal']);
const WRAPPER_SIGNAL_KEYS: ReadonlySet<string> = new Set(['signal', 'timeout']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    callees: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    defaultTimeoutMs: { type: 'integer', minimum: 1 },
  },
};

/** A string or template literal — a URL, never an options bag. */
function isUrlLike(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.TemplateLiteral ||
    (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string')
  );
}

function isNewRequest(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.NewExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'Request'
  );
}

/** `new Request(...)`, or an identifier bound by `const x = new Request(...)`. */
function isRequestObject(node: TSESTree.Node, scope: TSESLint.Scope.Scope): boolean {
  if (isNewRequest(node)) {
    return true;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  for (let current: TSESLint.Scope.Scope | null = scope; current; current = current.upper) {
    const variable = current.set.get(node.name);
    if (variable) {
      return variable.defs.some(
        (def) =>
          def.node.type === AST_NODE_TYPES.VariableDeclarator &&
          def.node.init !== null &&
          isNewRequest(def.node.init),
      );
    }
  }
  return false;
}

interface ObjectProbe {
  readonly satisfied: boolean; // has `signal` or `timeout`
  readonly opaque: boolean; // has a spread — cannot verify
}

function probeOptionsObject(object: TSESTree.ObjectExpression, signalKeys: ReadonlySet<string>): ObjectProbe {
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      return { satisfied: false, opaque: true };
    }
    const key = property.key;
    const name =
      key.type === AST_NODE_TYPES.Identifier
        ? key.name
        : key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string'
          ? key.value
          : null;
    if (name !== null && signalKeys.has(name)) {
      return { satisfied: true, opaque: false };
    }
  }
  return { satisfied: false, opaque: false };
}

export const requireFetchTimeoutRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A `fetch` (or configured wrapper) call must carry a `signal`/`timeout` in its options — an unbounded request can hang forever.',
    },
    hasSuggestions: true,
    schema: [optionSchema],
    messages: {
      missingTimeout:
        '`{{callee}}` has no timeout — pass a `signal` (e.g. `AbortSignal.timeout({{ms}})`) or a `timeout` option so the request cannot hang indefinitely.',
      addTimeout: 'Add `signal: AbortSignal.timeout({{ms}})`.',
    },
  },
  defaultOptions: [{ callees: [], defaultTimeoutMs: DEFAULT_TIMEOUT_MS }],
  create(context, [options]) {
    const timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const matched = new Set<string>(['fetch', ...(options.callees ?? [])]);

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const name = calleeText(node.callee);
        if (name === null || !matched.has(name)) {
          return;
        }
        const args = node.arguments;
        // Any spread argument makes the argument list opaque — cannot verify.
        if (args.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) {
          return;
        }

        const isGlobalFetch = name === 'fetch';
        const signalKeys = isGlobalFetch ? FETCH_SIGNAL_KEYS : WRAPPER_SIGNAL_KEYS;
        const objectArgs = args.filter(
          (arg): arg is TSESTree.ObjectExpression => arg.type === AST_NODE_TYPES.ObjectExpression,
        );

        if (objectArgs.length > 0) {
          const probes = objectArgs.map((arg) => probeOptionsObject(arg, signalKeys));
          if (probes.some((probe) => probe.satisfied || probe.opaque)) {
            return; // already timed out, or an opaque spread we won't second-guess.
          }
          const target = objectArgs[objectArgs.length - 1];
          if (target === undefined) {
            return;
          }
          context.report({
            node: node.callee,
            messageId: 'missingTimeout',
            data: { callee: name, ms: timeoutMs },
            suggest: [
              {
                messageId: 'addTimeout',
                data: { ms: timeoutMs },
                fix: (fixer) => {
                  const insertion = `signal: AbortSignal.timeout(${timeoutMs})`;
                  const first = target.properties[0];
                  if (first === undefined) {
                    return fixer.replaceText(target, `{ ${insertion} }`);
                  }
                  return fixer.insertTextBefore(first, `${insertion}, `);
                },
              },
            ],
          });
          return;
        }

        // No options object literal. For the global `fetch`, a lone first argument
        // is the resource, never the options; only a visible `Request` may carry a
        // signal. A wrapper's identifier/call argument may itself be an options bag.
        if (args.length === 0) {
          return;
        }
        const plainlyUnbounded = isGlobalFetch
          ? args.length === 1 && args[0] !== undefined && !isRequestObject(args[0], context.sourceCode.getScope(node))
          : args.every(isUrlLike);
        if (!plainlyUnbounded) {
          return;
        }
        const lastArg = args[args.length - 1];
        if (lastArg === undefined) {
          return;
        }
        context.report({
          node: node.callee,
          messageId: 'missingTimeout',
          data: { callee: name, ms: timeoutMs },
          suggest: [
            {
              messageId: 'addTimeout',
              data: { ms: timeoutMs },
              fix: (fixer) =>
                fixer.insertTextAfter(lastArg, `, { signal: AbortSignal.timeout(${timeoutMs}) }`),
            },
          ],
        });
      },
    };
  },
});
