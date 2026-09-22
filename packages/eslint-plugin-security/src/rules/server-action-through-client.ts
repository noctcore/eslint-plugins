import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { calleeText } from '../utils';

const RULE_NAME = 'server-action-through-client';

export interface ServerActionThroughClientOptions {
  readonly actionClients?: readonly string[];
  readonly allowInline?: boolean;
}

type RuleOptions = [ServerActionThroughClientOptions];
type MessageIds = 'rawExport' | 'notThroughClient' | 'inlineAction';

/*
 * A `'use server'` module turns every export into a public POST endpoint. The
 * safe shape is to build each one from an action client
 * (`actionClient.inputSchema(...).action(...)` in next-safe-action,
 * `createServerFn().middleware([...]).handler(...)` in TanStack Start), because
 * the client is where input validation, error shaping and middleware, including
 * auth middleware, live. A raw `export async function` has none of that.
 *
 * The invariant is deliberately NOT "every action authenticates". A public
 * contact form built from an `unauthenticatedAction` client is correct code,
 * and a rule that reports it is a rule people turn off. This rule enforces the
 * weaker, true property: in a module whose first statement is `'use server'`,
 * every exported function is built from a client named in `actionClients`, and
 * no raw function is exported. Which client is right is the project's call,
 * made visible at the definition site where a reviewer can read it.
 *
 * Purely syntactic. An exported binding passes when the innermost call of its
 * initializer's chain has a callee that is, or starts with, a configured client
 * (`unauthenticatedAction.metadata(...).inputSchema(...).action(...)` roots at
 * `unauthenticatedAction`; `createServerFn({ method: 'POST' }).handler(...)`
 * roots at `createServerFn`). Non-function exports (a constant, a type, a
 * re-export) are left alone. An empty `actionClients` accepts no client, so
 * every exported action is reported: the loud failure, never the silent one.
 *
 * Inline actions (`async function x() { 'use server'; ... }` in a component
 * body) cannot be built from a client, so they are reported unless
 * `allowInline` is set.
 *
 * Ships OFF: `actionClients` is a per-project fact with no universal default,
 * so `recommended` cannot turn this on for a stranger's repo.
 */
const DIRECTIVE = 'use server';

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actionClients: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    allowInline: { type: 'boolean' },
  },
};

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

function isFunction(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  );
}

/** True when the statement is the `'use server'` directive, in either quote style. */
function isUseServerDirective(statement: TSESTree.Statement | undefined): boolean {
  return (
    statement !== undefined &&
    statement.type === AST_NODE_TYPES.ExpressionStatement &&
    statement.expression.type === AST_NODE_TYPES.Literal &&
    statement.expression.value === DIRECTIVE
  );
}

/** True when a function's body opens with the `'use server'` directive. */
function hasInlineDirective(node: FunctionNode): boolean {
  return node.body.type === AST_NODE_TYPES.BlockStatement && isUseServerDirective(node.body.body[0]);
}

/** Strips the TypeScript and grouping wrappers that do not change what an expression is. */
function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current: TSESTree.Node = node;
  for (;;) {
    switch (current.type) {
      case AST_NODE_TYPES.TSAsExpression:
      case AST_NODE_TYPES.TSSatisfiesExpression:
      case AST_NODE_TYPES.TSNonNullExpression:
      case AST_NODE_TYPES.TSTypeAssertion:
      case AST_NODE_TYPES.TSInstantiationExpression:
        current = current.expression;
        break;
      case AST_NODE_TYPES.ChainExpression:
        current = current.expression;
        break;
      default:
        return current;
    }
  }
}

/**
 * The innermost call of a fluent chain: for `a.b(...).c(...).d(...)` that is
 * `a.b(...)`, whose callee text names the chain's root.
 */
function innermostCall(call: TSESTree.CallExpression): TSESTree.CallExpression {
  let current = call;
  for (;;) {
    const callee = unwrap(current.callee);
    if (callee.type !== AST_NODE_TYPES.MemberExpression) {
      return current;
    }
    const object = unwrap(callee.object);
    if (object.type !== AST_NODE_TYPES.CallExpression) {
      return current;
    }
    current = object;
  }
}

/**
 * `calleeText` with the TypeScript wrappers stripped at every step, so
 * `client!.action` and `(client as Client).action` read as `client.action`.
 */
function dottedText(node: TSESTree.Node): string | null {
  const bare = unwrap(node);
  if (bare.type === AST_NODE_TYPES.MemberExpression && !bare.computed) {
    const object = dottedText(bare.object);
    return object === null || bare.property.type !== AST_NODE_TYPES.Identifier ? null : `${object}.${bare.property.name}`;
  }
  return calleeText(bare);
}

/** True when the dotted callee is a configured client or a member reached through one. */
function rootsAtClient(rootText: string, clients: ReadonlySet<string>): boolean {
  if (clients.has(rootText)) {
    return true;
  }
  for (const client of clients) {
    if (rootText.startsWith(`${client}.`)) {
      return true;
    }
  }
  return false;
}

type Verdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'raw'; readonly node: TSESTree.Node }
  | { readonly kind: 'unrooted'; readonly node: TSESTree.Node; readonly root: string };

export const serverActionThroughClientRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "In a `'use server'` module every exported action must be built from a configured action client; a raw exported function bypasses input validation, error shaping and middleware. Opt-in: needs `actionClients`.",
    },
    schema: [optionSchema],
    messages: {
      rawExport:
        "`{{name}}` is exported from a `'use server'` module as a plain function, which makes it a public endpoint with no input schema, no error policy and no middleware, so no auth middleware either. Build it from a configured action client ({{clients}}).",
      notThroughClient:
        "`{{name}}` is exported from a `'use server'` module but its chain starts at `{{root}}`, which is not a configured action client ({{clients}}). Build it from one, or add `{{root}}` to `actionClients` if it is a client.",
      inlineAction:
        "`{{name}}` is an inline server action: a `'use server'` directive in a function body cannot go through an action client, so it has no input schema, error policy or middleware. Move it to a `'use server'` module built from a configured client, or set `allowInline: true` to accept inline actions.",
    },
  },
  defaultOptions: [{ actionClients: [], allowInline: false }],
  create(context, [options]) {
    const clients = new Set(options.actionClients ?? []);
    const allowInline = options.allowInline ?? false;
    const clientsText = clients.size === 0 ? 'none configured' : [...clients].map((c) => `\`${c}\``).join(', ');
    const sourceCode = context.sourceCode;

    const program = sourceCode.ast;
    const isServerModule = isUseServerDirective(program.body[0]);

    /** The declaration a module-scope identifier resolves to, when it has exactly one. */
    function resolveLocal(identifier: TSESTree.Identifier): TSESTree.Node | null {
      const scope = sourceCode.getScope(identifier);
      const variable = scope.set.get(identifier.name) ?? scope.upper?.set.get(identifier.name) ?? null;
      const definition = variable?.defs[0];
      return variable !== null && variable.defs.length === 1 && definition !== undefined ? definition.node : null;
    }

    /** Judges an exported initializer expression. */
    function judgeExpression(expression: TSESTree.Node, seen: ReadonlySet<TSESTree.Node>): Verdict {
      const value = unwrap(expression);
      if (isFunction(value)) {
        return { kind: 'raw', node: value };
      }
      if (value.type === AST_NODE_TYPES.CallExpression) {
        const root = innermostCall(value);
        const rootText = dottedText(root.callee);
        if (rootText !== null && rootsAtClient(rootText, clients)) {
          return { kind: 'ok' };
        }
        return { kind: 'unrooted', node: value, root: rootText ?? sourceCode.getText(root.callee) };
      }
      if (value.type === AST_NODE_TYPES.Identifier) {
        return judgeIdentifier(value, seen);
      }
      // A constant, an object, a `new` expression: not a function, not an action.
      return { kind: 'ok' };
    }

    /** Judges an exported name by following it to its local declaration. */
    function judgeIdentifier(identifier: TSESTree.Identifier, seen: ReadonlySet<TSESTree.Node>): Verdict {
      const declaration = resolveLocal(identifier);
      if (declaration === null || seen.has(declaration)) {
        // An import (a re-export) or something unresolvable: nothing to judge.
        return { kind: 'ok' };
      }
      const next = new Set(seen).add(declaration);
      if (declaration.type === AST_NODE_TYPES.FunctionDeclaration) {
        return { kind: 'raw', node: declaration };
      }
      if (declaration.type === AST_NODE_TYPES.VariableDeclarator && declaration.init !== null) {
        return judgeExpression(declaration.init, next);
      }
      return { kind: 'ok' };
    }

    function report(name: string, verdict: Verdict, at: TSESTree.Node): void {
      if (verdict.kind === 'raw') {
        context.report({ node: at, messageId: 'rawExport', data: { name, clients: clientsText } });
      } else if (verdict.kind === 'unrooted') {
        context.report({
          node: at,
          messageId: 'notThroughClient',
          data: { name, root: verdict.root, clients: clientsText },
        });
      }
    }

    /**
     * Reports a function whose body opens with `'use server'`, unless inline
     * actions are allowed. In a `'use server'` module the body directive is
     * redundant and the export checks govern, so nothing is reported here.
     */
    function checkInline(node: FunctionNode): void {
      if (allowInline || isServerModule || !hasInlineDirective(node)) {
        return;
      }
      const id = node.type === AST_NODE_TYPES.FunctionDeclaration ? node.id : null;
      const name =
        id !== null
          ? id.name
          : node.parent.type === AST_NODE_TYPES.VariableDeclarator && node.parent.id.type === AST_NODE_TYPES.Identifier
            ? node.parent.id.name
            : '(anonymous)';
      context.report({ node: id ?? node, messageId: 'inlineAction', data: { name } });
    }

    function nameOf(node: TSESTree.Node): string {
      if (node.type === AST_NODE_TYPES.Identifier) {
        return node.name;
      }
      return sourceCode.getText(node);
    }

    return {
      ExportNamedDeclaration(node): void {
        if (!isServerModule) {
          return;
        }
        // `export { x } from './y'` and `export type { T }` are not actions.
        if (node.source !== null || node.exportKind === 'type') {
          return;
        }
        const declaration = node.declaration;
        if (declaration === null) {
          for (const specifier of node.specifiers) {
            if (specifier.exportKind === 'type' || specifier.local.type !== AST_NODE_TYPES.Identifier) {
              continue;
            }
            report(nameOf(specifier.exported), judgeIdentifier(specifier.local, new Set()), specifier);
          }
          return;
        }
        if (declaration.type === AST_NODE_TYPES.FunctionDeclaration) {
          report(declaration.id?.name ?? 'default', { kind: 'raw', node: declaration }, declaration.id ?? declaration);
          return;
        }
        if (declaration.type === AST_NODE_TYPES.VariableDeclaration) {
          for (const declarator of declaration.declarations) {
            if (declarator.init === null) {
              continue;
            }
            report(nameOf(declarator.id), judgeExpression(declarator.init, new Set([declarator])), declarator.id);
          }
        }
        // A class, an enum, an interface, a type alias: not an action.
      },

      ExportDefaultDeclaration(node): void {
        if (!isServerModule) {
          return;
        }
        const declaration = node.declaration;
        if (declaration.type === AST_NODE_TYPES.FunctionDeclaration) {
          report(declaration.id?.name ?? 'default', { kind: 'raw', node: declaration }, declaration.id ?? node);
          return;
        }
        if (declaration.type === AST_NODE_TYPES.ClassDeclaration || declaration.type === AST_NODE_TYPES.TSInterfaceDeclaration) {
          return;
        }
        report('default', judgeExpression(declaration, new Set()), node);
      },

      FunctionDeclaration: checkInline,
      FunctionExpression: checkInline,
      ArrowFunctionExpression: checkInline,
    };
  },
});
