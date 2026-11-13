import { unwrapTypeWrappers } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeName, staticName } from '../utils/ast';

const RULE_NAME = 'prefix-query-key-must-use-set-queries-data';

export interface PrefixQueryKeyMustUseSetQueriesDataOptions {
  /** Exact-key client methods to check, replacing the defaults. */
  readonly methods?: readonly string[];
  /** Extra hook names whose `queryKey` declares a query, added to the defaults. */
  readonly queryHooks?: readonly string[];
}

type RuleOptions = [PrefixQueryKeyMustUseSetQueriesDataOptions];
type MessageIds = 'prefixKey' | 'useSetQueriesData' | 'useGetQueriesData';

/*
 * `setQueryData` and `getQueryData` address one exact key. When the file's
 * hooks build their key as `[...PREFIX, id]`, a call that passes the bare
 * `PREFIX` addresses an entry no hook reads: the write lands in an unobserved
 * cache slot, and the read returns `undefined`. The prefix-matching methods
 * are `setQueriesData` and `getQueriesData`.
 *
 * The rule stays silent when the bare PREFIX is itself the `queryKey` of a hook
 * in the file (a list beside its detail query), where the exact-key call is
 * correct. Filter methods such as `invalidateQueries` are prefix matches by
 * design and are never checked.
 *
 * The analysis is per file and lexical: the prefix is an identifier or a
 * non-computed member chain, compared by source text. A prefix used by a hook in
 * another file, a key built in a variable, a factory call and a `useQueries`
 * callback are not read.
 */
const DEFAULT_QUERY_HOOKS: readonly string[] = [
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useSuspenseInfiniteQuery',
  'queryOptions',
];

const DEFAULT_METHODS: readonly string[] = ['setQueryData', 'getQueryData'];

const PLURAL_METHODS: Readonly<Record<string, 'setQueriesData' | 'getQueriesData'>> = {
  setQueryData: 'setQueriesData',
  getQueryData: 'getQueriesData',
};

/** An identifier or a chain of non-computed property accesses on one. */
function isPlainPath(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.Identifier) return true;
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    isPlainPath(node.object)
  );
}

/** The `queryKey` value of an options object, or undefined. */
function queryKeyValue(node: TSESTree.Node): TSESTree.Node | undefined {
  const object = unwrapTypeWrappers(node);
  if (object.type !== AST_NODE_TYPES.ObjectExpression) return undefined;
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    if (staticName(property.key, property.computed) !== 'queryKey') continue;
    return unwrapTypeWrappers(property.value);
  }
  return undefined;
}

interface MethodCall {
  readonly node: TSESTree.CallExpression;
  readonly callee: TSESTree.MemberExpression;
  readonly method: string;
  readonly prefix: string;
}

export const prefixQueryKeyMustUseSetQueriesDataRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report `setQueryData(PREFIX, ...)` and `getQueryData(PREFIX)` when the file builds its query keys as `[...PREFIX, id]`: the exact-key call misses every entry, and `setQueriesData` / `getQueriesData` match the prefix.',
    },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          methods: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Exact-key client method names whose bare-prefix first argument is reported. Replaces the default list: `setQueryData`, `getQueryData`. A name with no known plural form is reported without a suggestion.',
          },
          queryHooks: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Hook or factory names whose `queryKey` declares a query, such as a wrapper around `useQuery`. Added to the default list: `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `queryOptions`.',
          },
        },
      },
    ],
    messages: {
      prefixKey:
        '`{{method}}({{prefix}})` addresses the exact key `{{prefix}}`, but the hooks in this file key their entries as `[...{{prefix}}, ...]`, so no entry matches. Use the prefix-matching `{{plural}}`, or pass the full key.',
      useSetQueriesData: 'Use `setQueriesData({ queryKey: {{prefix}} }, ...)`.',
      useGetQueriesData:
        'Use `getQueriesData({ queryKey: {{prefix}} })`. It returns `[queryKey, data]` pairs, so adjust the caller.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const hooks = new Set([...DEFAULT_QUERY_HOOKS, ...(options.queryHooks ?? [])]);
    const methods = new Set(options.methods ?? DEFAULT_METHODS);
    const { sourceCode } = context;

    const spreadPrefixes = new Set<string>();
    const bareKeys = new Set<string>();
    const calls: MethodCall[] = [];

    const textOf = (node: TSESTree.Node): string => sourceCode.getText(node);

    function recordHook(hookOptions: TSESTree.Node): void {
      const key = queryKeyValue(hookOptions);
      if (key === undefined) return;
      if (key.type !== AST_NODE_TYPES.ArrayExpression) {
        if (isPlainPath(key)) bareKeys.add(textOf(key));
        return;
      }
      const [first, ...rest] = key.elements;
      if (first?.type !== AST_NODE_TYPES.SpreadElement || rest.length === 0) return;
      const prefix = unwrapTypeWrappers(first.argument);
      if (isPlainPath(prefix)) spreadPrefixes.add(textOf(prefix));
    }

    function suggestionFix(call: MethodCall): TSESLint.ReportFixFunction | undefined {
      const plural = PLURAL_METHODS[call.method];
      const { property } = call.callee;
      const first = call.node.arguments[0];
      const last = call.node.arguments[call.node.arguments.length - 1];
      if (plural === undefined || call.callee.computed || first === undefined || last === undefined) {
        return undefined;
      }
      const filter = `{ queryKey: ${call.prefix} }`;
      const isGet = call.method === 'getQueryData';
      return (fixer) => [
        fixer.replaceText(property, plural),
        isGet
          ? fixer.replaceTextRange([first.range[0], last.range[1]], filter)
          : fixer.replaceText(first, filter),
      ];
    }

    return {
      CallExpression(node): void {
        const first = node.arguments[0];
        if (first === undefined) return;

        const callee = node.callee;
        if (callee.type === AST_NODE_TYPES.MemberExpression) {
          const method = staticName(callee.property, callee.computed);
          if (method !== undefined && methods.has(method)) {
            const arg = unwrapTypeWrappers(first);
            if (isPlainPath(arg)) calls.push({ node, callee, method, prefix: textOf(arg) });
            return;
          }
        }

        const name = calleeName(node);
        if (name !== undefined && hooks.has(name)) recordHook(first);
      },
      'Program:exit'(): void {
        for (const call of calls) {
          if (!spreadPrefixes.has(call.prefix) || bareKeys.has(call.prefix)) continue;
          const plural = PLURAL_METHODS[call.method] ?? 'setQueriesData';
          const fix = suggestionFix(call);
          context.report({
            node: call.node,
            messageId: 'prefixKey',
            data: { method: call.method, prefix: call.prefix, plural },
            suggest:
              fix === undefined
                ? []
                : [
                    {
                      messageId: call.method === 'getQueryData' ? 'useGetQueriesData' : 'useSetQueriesData',
                      data: { prefix: call.prefix },
                      fix,
                    },
                  ],
          });
        }
      },
    };
  },
});
