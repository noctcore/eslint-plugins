import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';
import ts from 'typescript';

import { createRule } from '../createRule';
import {
  type AuditGraphOptions,
  baseName,
  createAuditGraph,
  labelOf,
} from '../utils/audit-call-graph';
import {
  DEFAULT_RECEIVER_PATTERN,
  DEFAULT_TX_ROOT_NAMES,
  nameListSchema,
  nonEmptyNameListSchema,
  receiverPatternSchema,
} from '../utils/prisma-receiver';

const RULE_NAME = 'mutation-entry-must-reach-audit';

export interface MutationEntryMustReachAuditOptions {
  /** Decorators that mark a method as a mutation entry point (`@Mutation()`). */
  readonly entryDecorators?: readonly string[];
  /** Regular expression source (case-insensitive) an audit logger's name must match. */
  readonly auditReceiverPattern?: string;
  /** Methods on the audit logger that write an audit row. */
  readonly auditMethods?: readonly string[];
  /** Model delegates whose writes are themselves the audit row. */
  readonly auditModels?: readonly string[];
  /** Model delegates whose writes are deliberately not audited. */
  readonly unauditedModels?: readonly string[];
  /**
   * Entries never reported, as the rule names them (`AuthRouter.inviteState`):
   * for an entry whose write the walk over-approximates, such as one behind a
   * flag this entry never sets.
   */
  readonly ignoreEntries?: readonly string[];
  /** Calls deeper than this below the entry stop the walk, and the entry is not reported. */
  readonly maxDepth?: number;
  readonly receiverPattern?: string;
  readonly clientProperties?: readonly string[];
  readonly txRootNames?: readonly string[];
}

type RuleOptions = [MutationEntryMustReachAuditOptions];
type MessageIds = 'unauditedMutation';

/*
 * A mutation entry point (a method carrying one of `entryDecorators`, by
 * default a tRPC `@Mutation()`) whose call graph, resolved through the type
 * checker across files, reaches a Prisma write and reaches no audit write.
 *
 * WHY THE ENTRY AND NOT EVERY SERVICE METHOD. In a layered API the audit row
 * is written by the method that orchestrates the operation, while the helpers
 * it calls (a token service, a lockout counter, a user repository primitive)
 * write without auditing because their caller already does. A rule demanding
 * an audit in every mutating service method reports those helpers, which are
 * correct, and the rule gets disabled. The entry point is where "this
 * operation left a trail" is a property that has to hold.
 *
 * WHAT IT PROVES, AND ONLY THIS. That at least one audit write is reachable
 * from the entry. Not that it runs on every path, not that it runs after the
 * write succeeded, and not that it describes this write. It reports only when
 * it read the WHOLE reachable graph: an edge it cannot see into (an interface
 * or abstract method, a function held in a parameter, a value typed `any`) or
 * a graph deeper than `maxDepth` means the entry is not reported, because the
 * unread part might be the audit. See the rule docs for the blind spots.
 */
const DEFAULT_ENTRY_DECORATORS: readonly string[] = ['Mutation'];
const DEFAULT_AUDIT_RECEIVER_PATTERN = 'audit';
const DEFAULT_AUDIT_METHODS: readonly string[] = ['log'];
const DEFAULT_AUDIT_MODELS: readonly string[] = ['auditLog'];
const DEFAULT_MAX_DEPTH = 12;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entryDecorators: nonEmptyNameListSchema,
    auditReceiverPattern: { type: 'string', minLength: 1 },
    auditMethods: nonEmptyNameListSchema,
    auditModels: nameListSchema,
    unauditedModels: nameListSchema,
    ignoreEntries: nameListSchema,
    maxDepth: { type: 'integer', minimum: 1 },
    receiverPattern: receiverPatternSchema,
    clientProperties: nameListSchema,
    txRootNames: nameListSchema,
  },
};

/** The name a decorator is spelled with: `@Mutation`, `@Mutation(...)`, `@trpc.Mutation(...)`. */
function decoratorName(decorator: TSESTree.Decorator): string | null {
  const expression =
    decorator.expression.type === AST_NODE_TYPES.CallExpression
      ? decorator.expression.callee
      : decorator.expression;
  if (expression.type === AST_NODE_TYPES.Identifier) {
    return expression.name;
  }
  if (
    expression.type === AST_NODE_TYPES.MemberExpression &&
    !expression.computed &&
    expression.property.type === AST_NODE_TYPES.Identifier
  ) {
    return expression.property.name;
  }
  return null;
}

export const mutationEntryMustReachAuditRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a mutation entry point whose type-resolved call graph reaches a Prisma write to also reach an audit write. Reports only when the whole graph was read.',
    },
    schema: [optionSchema],
    messages: {
      unauditedMutation:
        '`{{entry}}` reaches a Prisma write ({{model}}.{{method}} at {{file}}:{{line}}, via {{path}}) and no audit write anywhere in its call graph. Audit the operation, list `{{model}}` in `unauditedModels` if its writes are deliberately not audited, or list `{{entry}}` in `ignoreEntries` if this path never performs the write.',
    },
  },
  defaultOptions: [
    {
      entryDecorators: [...DEFAULT_ENTRY_DECORATORS],
      auditReceiverPattern: DEFAULT_AUDIT_RECEIVER_PATTERN,
      auditMethods: [...DEFAULT_AUDIT_METHODS],
      auditModels: [...DEFAULT_AUDIT_MODELS],
      unauditedModels: [],
      ignoreEntries: [],
      maxDepth: DEFAULT_MAX_DEPTH,
    },
  ],
  create(context, [options]) {
    // Throws the standard "requires type information" error when the file is
    // linted without a program: silence here would read as coverage.
    const services = ESLintUtils.getParserServices(context);
    const entryDecorators = new Set(options.entryDecorators ?? DEFAULT_ENTRY_DECORATORS);
    const graphOptions: AuditGraphOptions = {
      auditReceiverPattern: new RegExp(
        options.auditReceiverPattern ?? DEFAULT_AUDIT_RECEIVER_PATTERN,
        'iu',
      ),
      auditMethods: new Set(options.auditMethods ?? DEFAULT_AUDIT_METHODS),
      auditModels: new Set(options.auditModels ?? DEFAULT_AUDIT_MODELS),
      unauditedModels: new Set(options.unauditedModels ?? []),
      receiverPattern: new RegExp(options.receiverPattern ?? DEFAULT_RECEIVER_PATTERN, 'iu'),
      clientProperties: new Set(options.clientProperties ?? []),
      txRootNames: new Set(options.txRootNames ?? DEFAULT_TX_ROOT_NAMES),
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    };
    const ignoreEntries = new Set(options.ignoreEntries ?? []);
    const graph = createAuditGraph(services.program, graphOptions);

    function check(
      member: TSESTree.MethodDefinition | TSESTree.PropertyDefinition,
      fn: TSESTree.Node,
    ): void {
      if (!member.decorators.some((decorator) => entryDecorators.has(decoratorName(decorator) ?? ''))) {
        return;
      }
      const tsNode = services.esTreeNodeToTSNodeMap.get(fn);
      if (!ts.isFunctionLike(tsNode) || !('body' in tsNode) || tsNode.body === undefined) {
        return;
      }
      const entry = tsNode as ts.FunctionLikeDeclaration;
      if (ignoreEntries.has(labelOf(entry))) {
        return;
      }
      const verdict = graph.verdictFor(entry);
      if (verdict.kind !== 'unaudited') {
        return;
      }
      context.report({
        node: member.key,
        messageId: 'unauditedMutation',
        data: {
          entry: verdict.path[0] ?? '?',
          model: verdict.write.model,
          method: verdict.write.method,
          file: baseName(verdict.write.fileName),
          line: String(verdict.write.line),
          path: verdict.path.join(' -> '),
        },
      });
    }

    return {
      MethodDefinition(node): void {
        // The MethodDefinition itself maps to the ts.MethodDeclaration.
        if (node.kind === 'method') {
          check(node, node);
        }
      },
      PropertyDefinition(node): void {
        if (
          node.value !== null &&
          (node.value.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            node.value.type === AST_NODE_TYPES.FunctionExpression)
        ) {
          check(node, node.value);
        }
      },
    };
  },
});
