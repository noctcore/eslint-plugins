import {
  calleePath,
  fileMatchesAnyGlob,
  isFunctionNode,
  unwrapTypeWrappers,
  type FunctionNode,
} from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-unguarded-web-storage';

export interface NoUnguardedWebStorageOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoUnguardedWebStorageOptions];
type MessageIds = 'unguarded' | 'wrapInTry';

/*
 * `localStorage` and `sessionStorage` are not plain objects. Reading the
 * property throws a `SecurityError` when storage is disabled (Firefox with
 * cookies blocked, a sandboxed iframe without `allow-same-origin`, third-party
 * storage partitioning), and `setItem` throws a `QuotaExceededError` when the
 * quota is exhausted, which is zero in some private modes. The code compiles,
 * tests pass under jsdom, and the exception lands in a render or an event
 * handler for a slice of real users.
 *
 * The rule flags a member read of `localStorage` or `sessionStorage`
 * (`getItem(...)`, `setItem(...)`, `length`, `['key']`), written bare, through
 * `window.`, `globalThis.` or `self.`, or through a `const` alias of either,
 * when no `try` with a `catch` covers it. Every member counts: the failing step
 * can be the property access itself. A `typeof window` check is not a guard;
 * it fences off the server, not the browser-side throw.
 *
 * A `try` only guards code that runs while it is on the stack. Walking up from
 * the access, a function boundary ends the search unless that function runs
 * synchronously right there (an IIFE, or the callback of an array method such
 * as `forEach`), so a listener or timer callback defined inside a `try` is not
 * guarded by it. A `try` with only a `finally` catches nothing.
 *
 * It stays silent for a wrapper (`safeStorage.get(...)`), for a bare reference
 * to the object (`createJSONStorage(() => localStorage)`), for a locally
 * declared `localStorage`, and in files matched by `allowIn` (tests and specs
 * by default, where storage runs under jsdom and cannot throw). Not autofixed,
 * since wrapping changes control flow; a suggestion wraps the statement in
 * `try { ... } catch { ... }` where that is a plain expression or return
 * statement.
 */
const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/tests/**',
  '**/e2e/**',
];

const STORAGE_GLOBALS = new Set(['localStorage', 'sessionStorage']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'File-path globs where a bare storage access is allowed. Replaces the default list of test globs.',
    },
  },
};

interface StorageAccess {
  /** The identifier the access starts from: `localStorage`, or `window` in `window.localStorage`. */
  readonly root: TSESTree.Identifier;
  /** The written access, e.g. `window.sessionStorage.getItem` or `store.length`. */
  readonly access: string;
}

function isIdentifierNamed(node: TSESTree.Node, names: ReadonlySet<string>): node is TSESTree.Identifier {
  return node.type === AST_NODE_TYPES.Identifier && names.has(node.name);
}

/**
 * The root identifier when `node` is the storage object itself: `localStorage`
 * bare, or `window.localStorage` (also through `globalThis` / `self`). Null
 * for anything else.
 */
function storageObjectRoot(node: TSESTree.Node): TSESTree.Identifier | null {
  if (isIdentifierNamed(node, STORAGE_GLOBALS)) {
    return node;
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    isIdentifierNamed(node.object, GLOBAL_OBJECTS) &&
    isIdentifierNamed(node.property, STORAGE_GLOBALS)
  ) {
    return node.object;
  }
  return null;
}

/** Array methods that call their callback before they return. */
const SYNC_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'sort',
  'toSorted',
]);

/**
 * True when `fn` runs before the expression around it finishes: an IIFE, or
 * the callback of a synchronous array method (`entries.forEach(() => ...)`,
 * `Array.from(keys, () => ...)`). An async function never counts, since
 * everything after its first `await` runs later.
 */
function runsSynchronously(fn: FunctionNode): boolean {
  const parent = fn.parent;
  if (fn.async || parent?.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  if (parent.callee === fn) {
    return true;
  }
  if (!parent.arguments.some((arg) => arg === fn)) {
    return false;
  }
  const callee = parent.callee;
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    SYNC_CALLBACK_METHODS.has(callee.property.name)
  ) {
    return true;
  }
  return calleePath(callee) === 'Array.from';
}

/**
 * True when a `try` with a `catch` is on the stack when `node` runs. A `catch`
 * or `finally` body is not covered by its own `try`, a `try` with only a
 * `finally` catches nothing, and a callback that runs later (a listener, a
 * timer, a `.then`) is not covered by a `try` around its definition.
 */
function isGuarded(node: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  // `Program.parent` is `null` at runtime, whatever the type says.
  let parent: TSESTree.Node | null | undefined = node.parent;
  while (parent != null) {
    if (isFunctionNode(child) && !runsSynchronously(child)) {
      return false;
    }
    if (
      parent.type === AST_NODE_TYPES.TryStatement &&
      parent.block === child &&
      parent.handler !== null
    ) {
      return true;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

type WrappableStatement = TSESTree.ExpressionStatement | TSESTree.ReturnStatement;

/**
 * The statement a `try` can be wrapped around without changing what the
 * code means: the nearest enclosing expression or return statement, when it
 * sits directly in a block. A `const x = ...` is skipped (wrapping it would
 * scope `x` to the `try`), and so is anything reached through a function
 * boundary or a braceless `if`.
 */
function wrappableStatement(node: TSESTree.Node): WrappableStatement | null {
  let current: TSESTree.Node | null | undefined = node.parent;
  while (current !== undefined && current !== null) {
    if (isFunctionNode(current)) {
      return null;
    }
    if (
      current.type === AST_NODE_TYPES.ExpressionStatement ||
      current.type === AST_NODE_TYPES.ReturnStatement
    ) {
      const container: TSESTree.Node | null | undefined = current.parent;
      const inBlock =
        container !== undefined &&
        container !== null &&
        (container.type === AST_NODE_TYPES.BlockStatement ||
          container.type === AST_NODE_TYPES.Program ||
          container.type === AST_NODE_TYPES.SwitchCase);
      return inBlock ? current : null;
    }
    if (current.type.endsWith('Statement') || current.type === AST_NODE_TYPES.VariableDeclaration) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

export const noUnguardedWebStorageRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A `localStorage` / `sessionStorage` access must sit inside a `try` with a `catch`: the access itself throws when storage is disabled, partitioned or full.',
    },
    hasSuggestions: true,
    schema: [optionSchema],
    messages: {
      unguarded:
        '`{{access}}` throws when storage is disabled, partitioned or full (private browsing, blocked cookies, a sandboxed iframe, an exhausted quota), and nothing here catches it. Wrap the call in `try { ... } catch { ... }` and fall back to a default.',
      wrapInTry: 'Wrap this statement in `try { ... } catch { ... }`.',
    },
  },
  defaultOptions: [{ allowIn: [...DEFAULT_ALLOW_IN] }],
  create(context, [options]) {
    const allowIn = options.allowIn ?? DEFAULT_ALLOW_IN;

    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd)) {
      return {};
    }

    const sourceCode = context.sourceCode;

    /** True unless the identifier resolves to a declaration in this file (a local `localStorage` shim). */
    function isGlobalReference(identifier: TSESTree.Identifier): boolean {
      const scope = sourceCode.getScope(identifier);
      const reference = scope.references.find((ref) => ref.identifier === identifier);
      if (reference === undefined || reference.resolved === null) {
        return true;
      }
      return reference.resolved.defs.length === 0;
    }

    /** The global storage root when `node` is the storage object, read directly. */
    function globalStorageRoot(node: TSESTree.Node): TSESTree.Identifier | null {
      const root = storageObjectRoot(node);
      return root !== null && isGlobalReference(root) ? root : null;
    }

    /**
     * The storage root behind a `const` alias (`const store = window.localStorage`),
     * or null when `identifier` is anything else.
     */
    function aliasedStorageRoot(identifier: TSESTree.Identifier): TSESTree.Identifier | null {
      const scope = sourceCode.getScope(identifier);
      const reference = scope.references.find((ref) => ref.identifier === identifier);
      const def = reference?.resolved?.defs.length === 1 ? reference.resolved.defs[0] : undefined;
      if (
        def?.node.type !== AST_NODE_TYPES.VariableDeclarator ||
        def.node.id.type !== AST_NODE_TYPES.Identifier ||
        def.node.init === null ||
        def.parent?.type !== AST_NODE_TYPES.VariableDeclaration ||
        def.parent.kind !== 'const'
      ) {
        return null;
      }
      return globalStorageRoot(unwrapTypeWrappers(def.node.init));
    }

    /** The written member name: `.getItem`, or `[key]` for a computed access. */
    function memberText(member: TSESTree.MemberExpression): string {
      return member.computed || member.property.type !== AST_NODE_TYPES.Identifier
        ? `[${sourceCode.getText(member.property)}]`
        : `.${member.property.name}`;
    }

    /** The storage member `member` reads, in any written form, or null. */
    function storageAccess(member: TSESTree.MemberExpression): StorageAccess | null {
      const object = member.object;
      const direct = globalStorageRoot(object);
      if (direct !== null) {
        return { root: direct, access: `${sourceCode.getText(object)}${memberText(member)}` };
      }
      if (object.type === AST_NODE_TYPES.Identifier && !STORAGE_GLOBALS.has(object.name)) {
        const aliased = aliasedStorageRoot(object);
        if (aliased !== null) {
          return { root: aliased, access: `${object.name}${memberText(member)}` };
        }
      }
      return null;
    }

    return {
      MemberExpression(member): void {
        const target = storageAccess(member);
        if (target === null) {
          return;
        }
        // A method call reports on the whole call, a plain read on the member.
        const node =
          member.parent.type === AST_NODE_TYPES.CallExpression && member.parent.callee === member
            ? member.parent
            : member;
        if (isGuarded(node)) {
          return;
        }

        const statement = wrappableStatement(node);
        context.report({
          node,
          messageId: 'unguarded',
          data: { access: target.access },
          suggest:
            statement === null
              ? []
              : [
                  {
                    messageId: 'wrapInTry',
                    fix: (fixer) => {
                      const line = sourceCode.lines[statement.loc.start.line - 1] ?? '';
                      const indent = /^\s*/u.exec(line)?.[0] ?? '';
                      const text = sourceCode.getText(statement);
                      return fixer.replaceText(
                        statement,
                        [
                          'try {',
                          `${indent}  ${text}`,
                          `${indent}} catch {`,
                          `${indent}  // Storage is unavailable or full. Fall back to the default.`,
                          `${indent}}`,
                        ].join('\n'),
                      );
                    },
                  },
                ],
        });
      },
    };
  },
});
