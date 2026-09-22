import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesAny } from '../utils';

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
 * The rule flags a call whose callee is a method of `localStorage` or
 * `sessionStorage`, written bare or through `window.`, `globalThis.` or
 * `self.`, when no enclosing `try` block covers it at any depth. Every method
 * counts (`getItem`, `setItem`, `removeItem`, `clear`, `key`): the failing
 * step can be the property access itself. A `typeof window` check is not a
 * guard; it fences off the server, not the browser-side throw.
 *
 * It stays silent for a wrapper (`safeStorage.get(...)`), for a non-call
 * reference (`createJSONStorage(() => localStorage)`), for a locally declared
 * `localStorage`, and in files matched by `allowIn` (tests and specs by
 * default, where storage runs under jsdom and cannot throw). Not autofixed,
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
    },
  },
};

interface StorageCallee {
  /** The identifier the access starts from: `localStorage`, or `window` in `window.localStorage`. */
  readonly root: TSESTree.Identifier;
  /** The written callee, e.g. `window.sessionStorage.getItem`. */
  readonly access: string;
}

function isIdentifierNamed(node: TSESTree.Node, names: ReadonlySet<string>): node is TSESTree.Identifier {
  return node.type === AST_NODE_TYPES.Identifier && names.has(node.name);
}

/** The storage global a call reads from, in either written form, or null. */
function storageCallee(callee: TSESTree.Node): StorageCallee | null {
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  const method = callee.property.name;
  const object = callee.object;
  // `localStorage.getItem(...)`
  if (isIdentifierNamed(object, STORAGE_GLOBALS)) {
    return { root: object, access: `${object.name}.${method}` };
  }
  // `window.localStorage.getItem(...)`
  if (
    object.type === AST_NODE_TYPES.MemberExpression &&
    !object.computed &&
    isIdentifierNamed(object.object, GLOBAL_OBJECTS) &&
    isIdentifierNamed(object.property, STORAGE_GLOBALS)
  ) {
    return {
      root: object.object,
      access: `${object.object.name}.${object.property.name}.${method}`,
    };
  }
  return null;
}

/** True when a `try` block encloses the node at any depth. A `catch` or `finally` body does not count. */
function isInsideTryBlock(node: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  // `Program.parent` is `null` at runtime, whatever the type says.
  let parent: TSESTree.Node | null | undefined = node.parent;
  while (parent !== undefined && parent !== null) {
    if (parent.type === AST_NODE_TYPES.TryStatement && parent.block === child) {
      return true;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

function isFunction(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
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
    if (isFunction(current)) {
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
        'A `localStorage` / `sessionStorage` call must sit inside a `try` block: the access itself throws when storage is disabled, partitioned or full.',
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

    if (matchesAny(context.filename, allowIn)) {
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

    return {
      CallExpression(node): void {
        const target = storageCallee(node.callee);
        if (target === null || !isGlobalReference(target.root)) {
          return;
        }
        if (isInsideTryBlock(node)) {
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
