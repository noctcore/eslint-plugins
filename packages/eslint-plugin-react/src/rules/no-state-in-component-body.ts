import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getBasename, matchesAnySuffix } from '../utils';

const RULE_NAME = 'no-state-in-component-body';

export interface NoStateInComponentBodyOptions {
  readonly allowedHooks?: readonly string[];
  readonly additionalHooks?: readonly string[];
  readonly storeHookPattern?: string;
  readonly hookFileSuffixes?: readonly string[];
}

type RuleOptions = [NoStateInComponentBodyOptions];
type MessageIds = 'stateInBody';

/*
 * State, effect, and query logic belongs in the colocated hook file
 * (`<Name>.hooks.ts` by convention), not in the component entry file
 * (`<Name>.tsx`), which should stay a thin presentation shell. React
 * state/effect/memo/ref hooks, react-query data hooks, and store hooks
 * (`use*Store`) are flagged. `useId`, `useTransition`, and `useDeferredValue`
 * are render-safe and allowlisted.
 *
 * The rule runs on component files (`.tsx`) and skips the colocated hook file —
 * any basename ending with a `hookFileSuffixes` entry (default `.hooks.ts`),
 * which is exactly where these hooks belong. It never anchors on a folder
 * layout; only the file extension and the configurable hook suffix are read.
 */
const DEFAULT_ALLOWED: readonly string[] = ['useId', 'useTransition', 'useDeferredValue'];

const DEFAULT_HOOK_FILE_SUFFIXES: readonly string[] = ['.hooks.ts'];

const REACT_STATEFUL_HOOKS: readonly string[] = [
  'useState',
  'useReducer',
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useImperativeHandle',
];

const REACT_QUERY_HOOKS: readonly string[] = [
  'useQuery',
  'useMutation',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useQueries',
];

const DEFAULT_STORE_PATTERN = '^use[A-Z][A-Za-z0-9]*Store$';

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedHooks: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    additionalHooks: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    storeHookPattern: { type: 'string' },
    hookFileSuffixes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

export const noStateInComponentBodyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'State/effect/query hooks must live in the colocated hook file (`<Name>.hooks.ts`), not in the component `.tsx` body. The component is a thin shell.',
    },
    schema: [optionSchema],
    messages: {
      stateInBody:
        '`{{hook}}` must live in the colocated hook file (e.g. `<Name>.hooks.ts`), not the component body. Move state/effect/query logic into the colocated hook.',
    },
  },
  defaultOptions: [{ allowedHooks: [...DEFAULT_ALLOWED] }],
  create(context, [options]) {
    const hookFileSuffixes = options.hookFileSuffixes ?? DEFAULT_HOOK_FILE_SUFFIXES;
    // The colocated hook file is exactly where these hooks belong — never flag there.
    if (matchesAnySuffix(context.filename, hookFileSuffixes)) {
      return {};
    }
    // Only component files (`.tsx`) carry a render body to keep thin.
    if (!getBasename(context.filename).endsWith('.tsx')) {
      return {};
    }

    const allowed = new Set(options.allowedHooks ?? DEFAULT_ALLOWED);
    const storePattern = new RegExp(options.storeHookPattern ?? DEFAULT_STORE_PATTERN);
    const flagged = new Set<string>([
      ...REACT_STATEFUL_HOOKS,
      ...REACT_QUERY_HOOKS,
      ...(options.additionalHooks ?? []),
    ]);

    function isFlaggedHook(name: string): boolean {
      if (allowed.has(name)) {
        return false;
      }
      return flagged.has(name) || storePattern.test(name);
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        const name = node.callee.name;
        if (isFlaggedHook(name)) {
          context.report({ node: node.callee, messageId: 'stateInBody', data: { hook: name } });
        }
      },
    };
  },
});
