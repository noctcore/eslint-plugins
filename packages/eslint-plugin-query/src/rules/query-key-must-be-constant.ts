import { fileMatchesAnyGlob, resolveAllowIn, unwrapTypeWrappers } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeName, staticName } from '../utils/ast';

const RULE_NAME = 'query-key-must-be-constant';

export interface QueryKeyMustBeConstantOptions {
  /** Hook and factory names whose `queryKey` / `mutationKey` is checked, added to the defaults. */
  readonly keyHookNames?: readonly string[];
  /** Client method names whose key argument is checked, added to the defaults. */
  readonly clientMethodNames?: readonly string[];
  /** Glob allowlist of files where inline keys are permitted. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [QueryKeyMustBeConstantOptions];
type MessageIds = 'inlineKey';

/*
 * A query key typed inline at each call site is a string that has to stay
 * identical in every place that reads, writes or invalidates the entry. Rename
 * `'user'` in one hook and the invalidation that still says `'user'` goes
 * silently dead: types pass and tests that mock the client still pass.
 *
 * The rule flags an inline array whose FIRST element is a string or template
 * literal, in the key slot of a hook or in the key argument of a client method.
 * A constant, a member (`USER_KEYS.me`), a factory call (`userKeys.detail(id)`)
 * and an array that starts with a spread are all left alone: they already come
 * from one place. A key array inside a key factory definition is not an
 * argument of a matched call, so it is never seen.
 *
 * The check is lexical: a key built in a variable first, or the elements of a
 * `useQueries({ queries: ids.map(...) })` callback, are not read.
 */
const DEFAULT_KEY_HOOKS: readonly string[] = [
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useSuspenseInfiniteQuery',
  'useMutation',
  'queryOptions',
  'useQueries',
];

const DEFAULT_CLIENT_METHODS: readonly string[] = [
  'invalidateQueries',
  'setQueryData',
  'removeQueries',
  'getQueryData',
  'prefetchQuery',
];

const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/__tests__/**',
];

const KEY_PROPERTIES: ReadonlySet<string> = new Set(['queryKey', 'mutationKey']);

/** The array when it is an inline key that starts with a string or template literal. */
function inlineStringKey(node: TSESTree.Node): TSESTree.ArrayExpression | undefined {
  const value = unwrapTypeWrappers(node);
  if (value.type !== AST_NODE_TYPES.ArrayExpression) return undefined;
  const first = value.elements[0];
  if (first === null || first === undefined) return undefined;
  if (first.type === AST_NODE_TYPES.TemplateLiteral) return value;
  if (first.type === AST_NODE_TYPES.Literal && typeof first.value === 'string') return value;
  return undefined;
}

/** Reports the inline key in `queryKey` / `mutationKey` of an options or filter object. */
function checkKeyObject(
  node: TSESTree.Node,
  report: (array: TSESTree.ArrayExpression, where: string) => void,
): void {
  const object = unwrapTypeWrappers(node);
  if (object.type !== AST_NODE_TYPES.ObjectExpression) return;
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const name = staticName(property.key, property.computed);
    if (name === undefined || !KEY_PROPERTIES.has(name)) continue;
    const array = inlineStringKey(property.value);
    if (array !== undefined) report(array, `\`${name}\``);
  }
}

/** The `queries` array of `useQueries({ queries: [...] })`, as its element nodes. */
function queriesElements(node: TSESTree.Node): readonly TSESTree.Node[] {
  const object = unwrapTypeWrappers(node);
  if (object.type !== AST_NODE_TYPES.ObjectExpression) return [];
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    if (staticName(property.key, property.computed) !== 'queries') continue;
    const value = unwrapTypeWrappers(property.value);
    if (value.type !== AST_NODE_TYPES.ArrayExpression) return [];
    return value.elements.filter(
      (element): element is TSESTree.Expression =>
        element !== null && element.type !== AST_NODE_TYPES.SpreadElement,
    );
  }
  return [];
}

export const queryKeyMustBeConstantRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require query and mutation keys to come from a constant or key factory, not an inline array that starts with a string.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          keyHookNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Hook or factory names whose `queryKey` / `mutationKey` is checked. Added to the default list: `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `queryOptions`, `useQueries`.',
          },
          clientMethodNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Client method names whose key filter or first argument is checked. Added to the default list: `invalidateQueries`, `setQueryData`, `removeQueries`, `getQueryData`, `prefetchQuery`.',
          },
          allowIn: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Globs of files where an inline key is allowed, such as a module that defines keys. Replaces the default list of test files.',
          },
        },
      },
    ],
    messages: {
      inlineKey:
        'This inline key in {{where}} repeats a string that must match everywhere the entry is read, written or invalidated. Take the key from a constant or a key factory so a rename touches one place. A file that defines keys belongs in `allowIn`.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const allowIn = resolveAllowIn(options, [], DEFAULT_ALLOW_IN);
    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd)) return {};

    const hooks = new Set([...DEFAULT_KEY_HOOKS, ...(options.keyHookNames ?? [])]);
    const methods = new Set([...DEFAULT_CLIENT_METHODS, ...(options.clientMethodNames ?? [])]);

    const reportAt = (array: TSESTree.ArrayExpression, where: string): void => {
      context.report({ node: array, messageId: 'inlineKey', data: { where } });
    };

    return {
      CallExpression(node): void {
        const first = node.arguments[0];
        if (first === undefined) return;

        const callee = node.callee;
        if (callee.type === AST_NODE_TYPES.MemberExpression) {
          const method = staticName(callee.property, callee.computed);
          if (method !== undefined && methods.has(method)) {
            const where = `\`${method}\``;
            if (unwrapTypeWrappers(first).type === AST_NODE_TYPES.ObjectExpression) {
              checkKeyObject(first, (array) => reportAt(array, where));
            } else {
              const array = inlineStringKey(first);
              if (array !== undefined) reportAt(array, where);
            }
            return;
          }
        }

        const name = calleeName(node);
        if (name === undefined || !hooks.has(name)) return;
        checkKeyObject(first, reportAt);
        if (name === 'useQueries') {
          for (const query of queriesElements(first)) checkKeyObject(query, reportAt);
        }
      },
    };
  },
});
