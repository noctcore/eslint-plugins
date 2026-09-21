import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { PRISMA_WRITE_METHODS } from '../utils/prisma-methods';
import {
  type ReceiverOptions,
  nameListSchema,
  receiverLooksLikePrisma,
  receiverPatternSchema,
  resolveReceiverOptions,
} from '../utils/prisma-receiver';

const RULE_NAME = 'prisma-tx-uses-tx-not-client';

export type PrismaTxUsesTxNotClientOptions = Pick<
  ReceiverOptions,
  'receiverPattern' | 'clientProperties' | 'txRootNames'
>;

type RuleOptions = [PrismaTxUsesTxNotClientOptions];
type MessageIds = 'mustUseTxParam';

/*
 * Inside a `$transaction(async (tx) => ...)` interactive callback, a write that
 * goes through the OUTER client (e.g. `this.prisma.invoice.create(...)`)
 * instead of the `tx` parameter (`tx.invoice.create(...)`) runs on a different
 * connection and silently escapes the transaction's rollback. Heuristic (no
 * type info): on entering a `.$transaction(fn)` call whose first argument is a
 * function with an Identifier first param, push that param name; while inside,
 * any Prisma write method call (`PRISMA_WRITE_METHODS`) whose receiver-chain
 * root identifier is NOT that param is reported, provided the receiver looks
 * like a Prisma client (`receiverLooksLikePrisma`) or is an outer transaction
 * param. Report-only: rewriting the receiver is not a trivially safe autofix.
 */
const WRITE_METHODS: ReadonlySet<string> = new Set(PRISMA_WRITE_METHODS);

const TRANSACTION_METHOD = '$transaction';

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    receiverPattern: receiverPatternSchema,
    clientProperties: nameListSchema,
    txRootNames: nameListSchema,
  },
};

/** True for an arrow function or a function expression (the interactive callback form). */
function isFunctionNode(
  node: TSESTree.Node | undefined,
): node is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression {
  return (
    node?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node?.type === AST_NODE_TYPES.FunctionExpression
  );
}

type NamedMemberCallee = TSESTree.MemberExpression & { property: TSESTree.Identifier };

/**
 * True when the callee is a non-computed member access with an Identifier
 * property (e.g. `this.prisma.$transaction`).
 */
function isNamedMemberCallee(callee: TSESTree.Node): callee is NamedMemberCallee {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  );
}

/**
 * The first parameter name of an interactive `$transaction` callback, or
 * undefined when the call is not the interactive form (no function callback, or
 * a non-Identifier first param such as a destructuring pattern). Returning
 * undefined means "do not police writes here", which keeps the rule quiet on
 * the array form `$transaction([...])`.
 */
function transactionParamName(node: TSESTree.CallExpression): string | undefined {
  if (!isNamedMemberCallee(node.callee) || node.callee.property.name !== TRANSACTION_METHOD) {
    return undefined;
  }
  const callback = node.arguments[0];
  if (!isFunctionNode(callback)) {
    return undefined;
  }
  const firstParam = callback.params[0];
  if (firstParam?.type === AST_NODE_TYPES.Identifier) {
    return firstParam.name;
  }
  return undefined;
}

/**
 * Root identifier name of a receiver chain. Walks `member.object` links down to
 * the base: `tx.invoice` -> 'tx', `this.prisma.invoice` -> undefined (root is
 * `this`, not an Identifier). A non-Identifier root never equals the tx param,
 * so it is treated as the outer client and reported.
 */
function receiverRootName(node: TSESTree.Node): string | undefined {
  let current: TSESTree.Node = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    current = current.object;
  }
  if (current.type === AST_NODE_TYPES.Identifier) {
    return current.name;
  }
  return undefined;
}

export const prismaTxUsesTxNotClientRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inside a `$transaction(async (tx) => ...)` callback, writes must go through the `tx` parameter, not the outer client, so they participate in the transaction and roll back together.',
    },
    schema: [optionSchema],
    messages: {
      mustUseTxParam:
        'Inside a $transaction(async (tx) => ...) callback, use tx.<model> for writes, not the outer client, which runs on a different connection and escapes rollback.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const receivers = resolveReceiverOptions(options);
    // Stack of active interactive-transaction param names. Innermost (last)
    // wins so nested transactions each police against their own `tx`.
    const txParamStack: string[] = [];

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const paramName = transactionParamName(node);
        if (paramName !== undefined) {
          txParamStack.push(paramName);
          return;
        }

        // Not inside any interactive transaction -> nothing to police.
        if (txParamStack.length === 0) {
          return;
        }

        const callee = node.callee;
        if (!isNamedMemberCallee(callee) || !WRITE_METHODS.has(callee.property.name)) {
          return;
        }

        const receiver = callee.object;
        const rootName = receiverRootName(receiver);
        const activeTxParam = txParamStack[txParamStack.length - 1];
        if (rootName === activeTxParam) {
          // The write already goes through the innermost tx param: compliant.
          return;
        }

        // Only police receivers that are actually a Prisma client. A write-named
        // method on something else (e.g. `createHash('sha256').update(...)`, a
        // Map/cache `.delete(key)`) is not a Prisma write and must not be
        // flagged. A receiver is a Prisma client when its chain looks like one,
        // or when its root is an OUTER transaction param (also a Prisma client,
        // just the wrong one for the active scope).
        const rootIsOuterTxParam = rootName !== undefined && txParamStack.includes(rootName);
        if (receiverLooksLikePrisma(receiver, receivers) || rootIsOuterTxParam) {
          context.report({ node, messageId: 'mustUseTxParam' });
        }
      },
      'CallExpression:exit'(node: TSESTree.CallExpression): void {
        if (transactionParamName(node) !== undefined) {
          txParamStack.pop();
        }
      },
    };
  },
});
