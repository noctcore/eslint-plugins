import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { nonEmptyNameListSchema } from '../utils/prisma-receiver';

const RULE_NAME = 'no-audit-write-in-transaction';

export interface NoAuditWriteInTransactionOptions {
  /** Regular expression source (case-insensitive) an audit logger's name must match. */
  readonly auditReceiverPattern?: string;
  /** Methods on the audit logger that write an audit row. */
  readonly auditMethods?: readonly string[];
}

type RuleOptions = [NoAuditWriteInTransactionOptions];
type MessageIds = 'auditInsideTransaction';

/*
 * An audit write made INSIDE a business `$transaction(...)` callback is rolled
 * back with the business work, so a failed operation erases its own evidence.
 * This rule reports an audit-logger call (`this.auditService.log(...)`) that is
 * lexically nested inside a `$transaction` callback, at any depth. The fix is to
 * audit after the commit; it is not a safe autofix, so the rule only reports.
 *
 * WHAT IT DOES NOT DO. It does not check that a mutation is audited at all. A
 * service method that writes and never calls the audit logger passes. This rule
 * was moved from a consumer where it was called `mutating-service-must-audit`,
 * a name that promised exactly that missing check, and the consumer's own
 * comments and docs came to rely on the promise. It is named for what it does.
 *
 * Heuristic, no type information: an audit logger is a receiver whose name (a
 * bare identifier or the last member, `this.<name>`) matches
 * `auditReceiverPattern`, called through one of `auditMethods`. A transaction
 * callback is a function passed as an argument to a `<anything>.$transaction(`
 * call. The array form `$transaction([...])` holds no callback and is not
 * inspected.
 */
const DEFAULT_AUDIT_RECEIVER_PATTERN = 'audit';
const DEFAULT_AUDIT_METHODS: readonly string[] = ['log'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    auditReceiverPattern: { type: 'string', minLength: 1 },
    auditMethods: nonEmptyNameListSchema,
  },
};

function receiverLooksLikeAudit(object: TSESTree.Node, pattern: RegExp): boolean {
  // `this.<name>` / `foo.<name>` where <name> matches (e.g. `this.auditService`).
  if (
    object.type === AST_NODE_TYPES.MemberExpression &&
    !object.computed &&
    object.property.type === AST_NODE_TYPES.Identifier
  ) {
    return pattern.test(object.property.name);
  }
  // A bare identifier that matches (e.g. `auditService`).
  if (object.type === AST_NODE_TYPES.Identifier) {
    return pattern.test(object.name);
  }
  return false;
}

function isTransactionCallback(fn: TSESTree.Node): boolean {
  // The function is an argument of a `<receiver>.$transaction(...)` call.
  const parent = fn.parent;
  if (parent === undefined || parent === null || parent.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  if (!parent.arguments.some((argument) => argument === fn)) {
    return false;
  }
  const callee = parent.callee;
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === '$transaction'
  );
}

function isInsideTransactionCallback(node: TSESTree.Node): boolean {
  // Walk lexical ancestry to the root: "inside the callback" is ancestor
  // containment, so a nested inner callback (a `.forEach(...)`) still counts.
  // `Program.parent` is null on every ESLint version, whatever its declared
  // type says, so both null and undefined end the walk.
  let current: TSESTree.Node | undefined | null = node.parent;
  while (current !== undefined && current !== null) {
    if (
      (current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        current.type === AST_NODE_TYPES.FunctionExpression) &&
      isTransactionCallback(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export const noAuditWriteInTransactionRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow an audit-log write inside a `$transaction` callback, where it rolls back with the business work. It does not check that mutations are audited at all.',
    },
    schema: [optionSchema],
    messages: {
      auditInsideTransaction:
        'Do not write the audit log inside a $transaction callback: if the transaction rolls back, the audit row is lost with it. Audit after the transaction commits.',
    },
  },
  defaultOptions: [
    {
      auditReceiverPattern: DEFAULT_AUDIT_RECEIVER_PATTERN,
      auditMethods: [...DEFAULT_AUDIT_METHODS],
    },
  ],
  create(context, [options]) {
    const pattern = new RegExp(
      options.auditReceiverPattern ?? DEFAULT_AUDIT_RECEIVER_PATTERN,
      'iu',
    );
    const methods = new Set(options.auditMethods ?? DEFAULT_AUDIT_METHODS);

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !methods.has(callee.property.name) ||
          !receiverLooksLikeAudit(callee.object, pattern)
        ) {
          return;
        }
        if (isInsideTransactionCallback(node)) {
          context.report({ node, messageId: 'auditInsideTransaction' });
        }
      },
    };
  },
});
