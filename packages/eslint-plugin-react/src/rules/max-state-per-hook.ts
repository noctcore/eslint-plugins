import { calleeName, enclosingFunction, type FunctionNode } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isHookName, matchesAnySuffix, stateSetterSource } from '../utils';

const RULE_NAME = 'max-state-per-hook';

export interface MaxStatePerHookOptions {
  readonly max?: number;
  readonly maxSettersPerFunction?: number;
  readonly countFrozen?: boolean;
  readonly hookFileSuffixes?: readonly string[];
  readonly fileSuffixes?: readonly string[];
}

type RuleOptions = [MaxStatePerHookOptions];
type MessageIds = 'tooMuchState' | 'tooManySetters';

/*
 * A screen hook that keeps eight `useState` slots is a state machine written
 * by hand: every handler has to set four or five of them in the right order,
 * and one forgotten reset leaves the screen in a combination no branch
 * expects. The pieces usually split three ways: values that can be derived
 * during render, busy flags a mutation already tracks (`isPending`,
 * `variables`), and the rest, which belongs in one `useReducer` whose events
 * name the transitions.
 *
 * Two counts, both only in hook files (`hookFileSuffixes`, default
 * `.hooks.ts` / `.hooks.tsx`), read from the basename:
 *
 * - Per hook: `useState` and `useReducer` calls whose nearest enclosing
 *   function is a `use*` function, exported or not. A private sub-hook keeps
 *   its own budget, which is the point: splitting a concern out is the fix. A
 *   frozen snapshot (`const [x] = useState(init)`, no setter) never changes, so
 *   it is skipped unless `countFrozen` is set.
 * - Per action: inside any function nested in the hook (a handler, an effect
 *   body, a `.then` callback), the distinct `useState` setters it calls. Five
 *   setters in one handler is one reducer event spelled out by hand.
 *   `dispatch` from `useReducer` is not a setter, and a setter from a prop or
 *   a context hook is not resolved to local state, so neither counts.
 */
const DEFAULT_MAX = 4;

const DEFAULT_MAX_SETTERS_PER_FUNCTION = 3;

const DEFAULT_HOOK_FILE_SUFFIXES: readonly string[] = ['.hooks.ts', '.hooks.tsx'];

const STATE_HOOKS: ReadonlySet<string> = new Set(['useState', 'useReducer']);

const suffixListSchema = (description: string): JSONSchema4 => ({
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description,
});

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    max: {
      type: 'integer',
      minimum: 1,
      description: 'Most `useState` / `useReducer` slots one hook may keep. Default 4.',
    },
    maxSettersPerFunction: {
      type: 'integer',
      minimum: 0,
      description:
        'Most distinct `useState` setters one function nested in a hook may call. Default 3; 0 turns this check off.',
    },
    countFrozen: {
      type: 'boolean',
      description:
        'Also count a `useState` whose setter is never destructured (`const [x] = useState(init)`). Default false.',
    },
    hookFileSuffixes: suffixListSchema(
      'Basename suffixes of the hook files to check. Default `.hooks.ts` and `.hooks.tsx`.',
    ),
    fileSuffixes: suffixListSchema(
      'Alias of `hookFileSuffixes`, the name `max-hooks-per-file` uses. When both are set, the suffixes are combined.',
    ),
  },
};

/** `hookFileSuffixes` and its `fileSuffixes` alias, combined when both are set. */
function resolveHookFileSuffixes(options: MaxStatePerHookOptions): readonly string[] {
  const lists = [options.hookFileSuffixes, options.fileSuffixes].filter(
    (value): value is readonly string[] => value !== undefined,
  );
  if (lists.length === 0) {
    return DEFAULT_HOOK_FILE_SUFFIXES;
  }
  return [...new Set(lists.flat())];
}

/** The hook name of a function, from its declaration or the variable it initialises. */
function hookNameNode(fn: FunctionNode): TSESTree.Identifier | null {
  if (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression && fn.id !== null && isHookName(fn.id.name)) {
    return fn.id;
  }
  const parent = fn.parent;
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === fn &&
    parent.id.type === AST_NODE_TYPES.Identifier &&
    isHookName(parent.id.name)
  ) {
    return parent.id;
  }
  return null;
}

/** A function's own name, used to place the per-action report; null for an inline callback. */
function functionNameNode(fn: FunctionNode): TSESTree.Identifier | null {
  if (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression && fn.id !== null) {
    return fn.id;
  }
  const parent = fn.parent;
  return parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === fn &&
    parent.id.type === AST_NODE_TYPES.Identifier
    ? parent.id
    : null;
}

/** True for a `useState` whose setter is never bound: `const [x] = useState(init)`. */
function isFrozenSnapshot(call: TSESTree.CallExpression): boolean {
  const parent = call.parent;
  return (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === call &&
    parent.id.type === AST_NODE_TYPES.ArrayPattern &&
    (parent.id.elements[1] ?? null) === null
  );
}

interface ActionSetters {
  readonly setters: Set<TSESTree.CallExpression>;
  /** The call that pushed the count past the limit, reported when the function has no name. */
  overflow: TSESTree.CallExpression | null;
}

export const maxStatePerHookRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A `use*` hook in a hook file may keep at most `max` (default 4) `useState` / `useReducer` slots, and a function inside it may call at most `maxSettersPerFunction` (default 3) distinct setters. Group the rest in a reducer.',
    },
    schema: [optionSchema],
    messages: {
      tooMuchState:
        "'{{hook}}' keeps {{count}} pieces of state (max {{max}}). Derive what you can, take busy flags from the mutation (isPending/variables), and group the rest in a useReducer.",
      tooManySetters:
        'This action calls {{count}} state setters (max {{max}}). Make it one reducer event.',
    },
  },
  defaultOptions: [
    {
      max: DEFAULT_MAX,
      maxSettersPerFunction: DEFAULT_MAX_SETTERS_PER_FUNCTION,
      countFrozen: false,
    },
  ],
  create(context, [options]) {
    if (!matchesAnySuffix(context.filename, resolveHookFileSuffixes(options))) {
      return {};
    }
    const max = options.max ?? DEFAULT_MAX;
    const maxSetters = options.maxSettersPerFunction ?? DEFAULT_MAX_SETTERS_PER_FUNCTION;
    const countFrozen = options.countFrozen ?? false;

    /** Local names an aliased `react` import binds to `useState` / `useReducer`. */
    const aliases = new Map<string, string>();
    /** State slots per hook function, in source order. */
    const slotsByHook = new Map<FunctionNode, number>();
    /** Distinct setters per function nested in a hook. */
    const settersByFunction = new Map<FunctionNode, ActionSetters>();

    /** `useState` or `useReducer` for a state hook callee (`React.useState` included), else null. */
    function stateHookKind(callee: TSESTree.Expression): string | null {
      if (callee.type === AST_NODE_TYPES.Identifier) {
        return STATE_HOOKS.has(callee.name) ? callee.name : (aliases.get(callee.name) ?? null);
      }
      const name = callee.type === AST_NODE_TYPES.MemberExpression ? calleeName(callee) : null;
      return name !== null && STATE_HOOKS.has(name) ? name : null;
    }

    function countSlot(call: TSESTree.CallExpression, kind: string): void {
      const owner = enclosingFunction(call);
      if (owner === null || hookNameNode(owner) === null) {
        return;
      }
      if (kind === 'useState' && !countFrozen && isFrozenSnapshot(call)) {
        return;
      }
      slotsByHook.set(owner, (slotsByHook.get(owner) ?? 0) + 1);
    }

    function countSetter(call: TSESTree.CallExpression, callee: TSESTree.Identifier): void {
      const source = stateSetterSource(callee, context.sourceCode.getScope(callee));
      // `dispatch` sends one event; that is the shape this check asks for.
      if (source === null || calleeName(source.callee) === 'useReducer') {
        return;
      }
      const owner = enclosingFunction(call);
      // A setter called in the hook body itself is not an action.
      if (owner === null || hookNameNode(owner) !== null) {
        return;
      }
      const entry = settersByFunction.get(owner) ?? { setters: new Set(), overflow: null };
      entry.setters.add(source);
      if (entry.setters.size === maxSetters + 1) {
        entry.overflow = call;
      }
      settersByFunction.set(owner, entry);
    }

    return {
      ImportDeclaration(node): void {
        if (node.source.value !== 'react') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === AST_NODE_TYPES.ImportSpecifier &&
            specifier.imported.type === AST_NODE_TYPES.Identifier &&
            STATE_HOOKS.has(specifier.imported.name) &&
            specifier.local.name !== specifier.imported.name
          ) {
            aliases.set(specifier.local.name, specifier.imported.name);
          }
        }
      },
      CallExpression(node): void {
        const kind = stateHookKind(node.callee);
        if (kind !== null) {
          countSlot(node, kind);
          return;
        }
        if (maxSetters > 0 && node.callee.type === AST_NODE_TYPES.Identifier) {
          countSetter(node, node.callee);
        }
      },
      'Program:exit'(): void {
        for (const [hook, count] of slotsByHook) {
          const name = hookNameNode(hook);
          if (count > max && name !== null) {
            context.report({
              node: name,
              messageId: 'tooMuchState',
              data: { hook: name.name, count, max },
            });
          }
        }
        if (maxSetters === 0) {
          return;
        }
        for (const [fn, { setters, overflow }] of settersByFunction) {
          if (setters.size > maxSetters) {
            context.report({
              node: functionNameNode(fn) ?? overflow ?? fn,
              messageId: 'tooManySetters',
              data: { count: setters.size, max: maxSetters },
            });
          }
        }
      },
    };
  },
});
