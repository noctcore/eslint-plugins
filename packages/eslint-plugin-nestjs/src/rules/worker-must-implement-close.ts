import { calleePath, forEachDescendant } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { isBullmqNew, listenerChain } from '../utils/bullmq';

const RULE_NAME = 'worker-must-implement-close';

const DEFAULT_CLOSE_METHOD_NAMES: readonly string[] = [
  'close',
  'shutdown',
  'dispose',
  'onModuleDestroy',
  'onApplicationShutdown',
  'beforeApplicationShutdown',
];

export interface WorkerMustImplementCloseOptions {
  /** Methods that may close the worker. Replaces the defaults. */
  readonly closeMethodNames?: readonly string[];
}

type RuleOptions = [WorkerMustImplementCloseOptions];
type MessageIds = 'missingClose';

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;
type FunctionValue = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

interface OwnedWorker {
  readonly field: string;
  readonly node: TSESTree.NewExpression;
}

function skipTypeWrappers(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.parent !== undefined &&
    (current.parent.type === AST_NODE_TYPES.TSAsExpression ||
      current.parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.parent.type === AST_NODE_TYPES.TSTypeAssertion)
  ) {
    current = current.parent;
  }
  return current;
}

/** The name of an instance member with a plain identifier key, else null. */
function instanceMemberName(
  member: TSESTree.MethodDefinition | TSESTree.PropertyDefinition,
): string | null {
  if (member.static || member.computed || member.key.type !== AST_NODE_TYPES.Identifier) return null;
  return member.key.name;
}

/** The class whose instance member has `fn` as its value, or null. */
function memberClass(fn: FunctionValue): ClassNode | null {
  const member = fn.parent;
  if (
    (member.type !== AST_NODE_TYPES.MethodDefinition &&
      member.type !== AST_NODE_TYPES.PropertyDefinition) ||
    member.value !== fn ||
    member.static
  ) {
    return null;
  }
  return member.parent.parent;
}

/**
 * The class `this` refers to at `node`: the nearest enclosing function that is
 * not an arrow must be an instance method (or an arrow-valued field) of it. A
 * plain nested `function` rebinds `this`, so nothing is attributed through it.
 */
function thisClass(node: TSESTree.Node): ClassNode | null {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    switch (current.type) {
      case AST_NODE_TYPES.ArrowFunctionExpression: {
        const owner = memberClass(current);
        if (owner !== null) return owner;
        break;
      }
      case AST_NODE_TYPES.FunctionExpression:
        return memberClass(current);
      case AST_NODE_TYPES.FunctionDeclaration:
      case AST_NODE_TYPES.StaticBlock:
      case AST_NODE_TYPES.ClassBody:
        return null;
      default:
        break;
    }
  }
  return null;
}

/** The class and field that own a worker expression, or null when it is not a field of a class. */
function ownerOf(top: TSESTree.Node): { readonly owner: ClassNode; readonly field: string } | null {
  const value = skipTypeWrappers(top);
  const parent = value.parent;
  if (parent?.type === AST_NODE_TYPES.PropertyDefinition && parent.value === value) {
    const field = instanceMemberName(parent);
    return field === null ? null : { owner: parent.parent.parent, field };
  }
  if (
    parent?.type === AST_NODE_TYPES.AssignmentExpression &&
    parent.operator === '=' &&
    parent.right === value &&
    parent.left.type === AST_NODE_TYPES.MemberExpression &&
    parent.left.object.type === AST_NODE_TYPES.ThisExpression &&
    !parent.left.computed &&
    parent.left.property.type === AST_NODE_TYPES.Identifier
  ) {
    const owner = thisClass(parent);
    return owner === null ? null : { owner, field: parent.left.property.name };
  }
  return null;
}

/*
 * A worker the class builds is a worker the class must close. Without
 * `await worker.close()` in a shutdown hook, the process exits with jobs still
 * running: they are abandoned mid-flight, stall, and run again on another
 * worker after the lock expires, while the Redis connection is dropped instead
 * of released. A NestJS `@Processor` extending `WorkerHost` builds no worker of
 * its own, so it is never an owner here.
 */
export const workerMustImplementCloseRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a class that creates a BullMQ `Worker` in a field to call `.close()` on it in a shutdown method such as `onModuleDestroy`, so in-flight jobs are not abandoned.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          closeMethodNames: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
            minItems: 1,
            description:
              'Names of the methods that may close the worker; one of them must call `this.<field>.close()`. Replaces the defaults `close`, `shutdown`, `dispose`, `onModuleDestroy`, `onApplicationShutdown` and `beforeApplicationShutdown`.',
          },
        },
      },
    ],
    messages: {
      missingClose:
        'This class creates the BullMQ worker `this.{{field}}` but no {{methods}} method calls `this.{{field}}.close()`, so shutdown abandons its running jobs. Close it in `onModuleDestroy`.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const closeMethodNames = new Set(options.closeMethodNames ?? DEFAULT_CLOSE_METHOD_NAMES);
    const methodList = [...closeMethodNames].map((name) => `\`${name}\``).join(' / ');
    const owned = new Map<ClassNode, OwnedWorker[]>();

    /** The `this.<field>` names closed by `.close()` calls in the class's close methods. */
    function closedFields(owner: ClassNode): Set<string> {
      const closed = new Set<string>();
      for (const member of owner.body.body) {
        if (
          member.type !== AST_NODE_TYPES.MethodDefinition &&
          member.type !== AST_NODE_TYPES.PropertyDefinition
        ) {
          continue;
        }
        const name = instanceMemberName(member);
        if (name === null || !closeMethodNames.has(name)) continue;
        if (member.type === AST_NODE_TYPES.MethodDefinition && member.kind !== 'method') continue;
        const value = member.value;
        if (
          value?.type !== AST_NODE_TYPES.FunctionExpression &&
          value?.type !== AST_NODE_TYPES.ArrowFunctionExpression
        ) {
          continue;
        }
        forEachDescendant(value.body, context.sourceCode.visitorKeys, (node) => {
          if (
            node.type !== AST_NODE_TYPES.CallExpression ||
            node.callee.type !== AST_NODE_TYPES.MemberExpression ||
            node.callee.computed ||
            node.callee.property.type !== AST_NODE_TYPES.Identifier ||
            node.callee.property.name !== 'close'
          ) {
            return;
          }
          const path = calleePath(node.callee.object, { allowThis: true });
          if (path?.startsWith('this.') === true) closed.add(path.slice('this.'.length));
        });
      }
      return closed;
    }

    function checkClass(owner: ClassNode): void {
      const workers = owned.get(owner);
      if (workers === undefined) return;
      owned.delete(owner);
      const closed = closedFields(owner);
      for (const worker of workers) {
        if (closed.has(worker.field)) continue;
        context.report({
          node: worker.node,
          messageId: 'missingClose',
          data: { field: worker.field, methods: methodList },
        });
      }
    }

    return {
      NewExpression(node): void {
        if (!isBullmqNew(node, 'Worker', context.sourceCode.getScope(node))) return;
        const found = ownerOf(listenerChain(node).top);
        if (found === null) return;
        const workers = owned.get(found.owner) ?? [];
        workers.push({ field: found.field, node });
        owned.set(found.owner, workers);
      },
      'ClassDeclaration:exit': checkClass,
      'ClassExpression:exit': checkClass,
    };
  },
});
