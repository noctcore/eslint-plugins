import { ASTUtils, AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { stripTypeWrappers } from '../utils/bullmq';
import {
  createReceiverIndex,
  fileImports,
  isImportOf,
  isJobQueueReceiver,
  JOBS_MODULE,
  methodCall,
} from '../utils/jobs';
import { queuePatternRegExp, queuePatternSchema } from '../utils/queue';

const RULE_NAME = 'no-dynamic-job-name';

export interface NoDynamicJobNameOptions {
  /** Case-insensitive pattern a receiver name must match to count as a queue when the file does not say. */
  readonly queuePattern?: string;
}

type RuleOptions = [NoDynamicJobNameOptions];
type MessageIds = 'jobName' | 'sweepName';

/** True for `process.env.X` and `process.env['X']`. */
function isEnvRead(node: TSESTree.MemberExpression): boolean {
  const object = stripTypeWrappers(node.object);
  return (
    object.type === AST_NODE_TYPES.MemberExpression &&
    !object.computed &&
    object.property.type === AST_NODE_TYPES.Identifier &&
    object.property.name === 'env' &&
    object.object.type === AST_NODE_TYPES.Identifier &&
    object.object.name === 'process'
  );
}

/**
 * The part of `node` that builds a name at run time: a template literal with
 * substitutions, a `+` concatenation, a call (`String(kind)`,
 * `parts.join('-')`) or a `process.env` read. A conditional or logical
 * expression is built when either side is. Null for a literal, an identifier,
 * a member access and anything else that names one value.
 */
function builtPart(node: TSESTree.Node): TSESTree.Node | null {
  const inner = stripTypeWrappers(node);
  switch (inner.type) {
    case AST_NODE_TYPES.TemplateLiteral:
      return inner.expressions.length > 0 ? inner : null;
    case AST_NODE_TYPES.BinaryExpression:
      return inner.operator === '+' ? inner : null;
    case AST_NODE_TYPES.CallExpression:
      return inner;
    case AST_NODE_TYPES.MemberExpression:
      return isEnvRead(inner) ? inner : null;
    case AST_NODE_TYPES.ConditionalExpression:
      return builtPart(inner.consequent) ?? builtPart(inner.alternate);
    case AST_NODE_TYPES.LogicalExpression:
      return builtPart(inner.left) ?? builtPart(inner.right);
    default:
      return null;
  }
}

/*
 * The job name of `add()` on a `@noctcore/jobs` queue and the name of a
 * `@Sweep()` are fixed strings. A name built at run time defeats the queue's
 * typed job map (no handler branch matches it), splits the `job` metric label
 * into one series per value, and for a sweep makes the scheduler id differ
 * between deploys or replicas, so each boot's reconcile removes the other's
 * scheduler. A name whose value is known statically passes, and so does an
 * identifier or member access (a constant, or a parameter typed as one of the
 * map's names); a template with substitutions, a concatenation, a call and a
 * `process.env` read are reported.
 *
 * Only files that import `@noctcore/jobs` are checked. `add()` receivers are
 * read like the other jobs rules read them: a `JobQueue` the file shows, else
 * a name matching `queuePattern`, never a BullMQ queue (`queue.bull`).
 */
export const noDynamicJobNameRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the job name of `add()` on a `@noctcore/jobs` queue and the name of a `@Sweep()` to be fixed strings, not built at run time.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          queuePattern: queuePatternSchema,
        },
      },
    ],
    messages: {
      jobName:
        'Pass a fixed job name and put the varying part in the job data. A name built at run time matches no entry of the typed job map and gives the `job` metric one series per value.',
      sweepName:
        'Give this sweep a fixed name. The name is the BullMQ scheduler id: one built at run time differs between deploys or replicas, and each boot removes the scheduler the other one made.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const sourceCode = context.sourceCode;
    if (!fileImports(sourceCode, JOBS_MODULE)) return {};
    const pattern = queuePatternRegExp(options.queuePattern);
    const index = createReceiverIndex(sourceCode);
    const adds: { readonly receiver: TSESTree.Node; readonly name: TSESTree.Node }[] = [];

    function isStaticString(node: TSESTree.Node): boolean {
      const value = ASTUtils.getStaticValue(stripTypeWrappers(node), sourceCode.getScope(node));
      return typeof value?.value === 'string';
    }

    return {
      NewExpression(node): void {
        index.record(node);
      },
      CallExpression(node): void {
        const call = methodCall(node);
        const [first] = node.arguments;
        // `add(name, data, ...)`: a one-argument `add` (a set, a task queue) is something else.
        if (call?.method !== 'add' || node.arguments.length < 2) return;
        if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) return;
        adds.push({ receiver: call.receiver, name: first });
      },
      Decorator(node): void {
        const expression = node.expression;
        if (
          expression.type !== AST_NODE_TYPES.CallExpression ||
          !isImportOf(expression.callee, JOBS_MODULE, 'Sweep', sourceCode)
        ) {
          return;
        }
        const [first] = expression.arguments;
        if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement || isStaticString(first)) return;
        const built = builtPart(first);
        if (built !== null) context.report({ node: built, messageId: 'sweepName' });
      },
      'Program:exit'(): void {
        for (const { receiver, name } of adds) {
          if (isStaticString(name) || !isJobQueueReceiver(receiver, index, pattern)) continue;
          const built = builtPart(name);
          if (built !== null) context.report({ node: built, messageId: 'jobName' });
        }
      },
    };
  },
});
