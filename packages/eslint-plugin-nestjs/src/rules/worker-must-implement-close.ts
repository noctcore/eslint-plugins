import { forEachDescendant } from '@noctcore/eslint-utils';
import { ASTUtils, AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import {
  type ClassNode,
  isBullmqNew,
  listenerChain,
  outermostTypeWrapper,
  stripTypeWrappers,
  thisClass,
  WORKER_ASSIGNMENT_OPERATORS,
} from '../utils/bullmq';

const RULE_NAME = 'worker-must-implement-close';

const DEFAULT_CLOSE_METHOD_NAMES: readonly string[] = [
  'close',
  'shutdown',
  'dispose',
  'onModuleDestroy',
  'onApplicationShutdown',
  'beforeApplicationShutdown',
];

/** The close method the message points to when the configured names include it. */
const PREFERRED_CLOSE_METHOD = 'onModuleDestroy';

export interface WorkerMustImplementCloseOptions {
  /** Methods that may close the worker. Replaces the defaults. */
  readonly closeMethodNames?: readonly string[];
}

type RuleOptions = [WorkerMustImplementCloseOptions];
type MessageIds = 'missingClose';

type FunctionValue = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

interface OwnedWorker {
  readonly field: string;
  readonly node: TSESTree.NewExpression;
}

/** A method body found in the class chain, with the index of the class that declares it. */
interface MethodHit {
  readonly fn: FunctionValue;
  readonly level: number;
}

/** The name of an instance member with a plain identifier key, else null. */
function instanceMemberName(member: TSESTree.ClassElement): string | null {
  if (
    member.type === AST_NODE_TYPES.StaticBlock ||
    member.type === AST_NODE_TYPES.TSIndexSignature ||
    member.static ||
    member.computed ||
    member.key.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  return member.key.name;
}

/** `this.<field>` read directly, with type wrappers ignored, gives `<field>`; anything else null. */
function thisField(node: TSESTree.Node): string | null {
  const inner = stripTypeWrappers(node);
  return inner.type === AST_NODE_TYPES.MemberExpression &&
    !inner.computed &&
    inner.property.type === AST_NODE_TYPES.Identifier &&
    stripTypeWrappers(inner.object).type === AST_NODE_TYPES.ThisExpression
    ? inner.property.name
    : null;
}

/** The class and field that own a worker expression, or null when it is not a field of a class. */
function ownerOf(top: TSESTree.Node): { readonly owner: ClassNode; readonly field: string } | null {
  const value = outermostTypeWrapper(top);
  const parent = value.parent;
  if (parent?.type === AST_NODE_TYPES.PropertyDefinition && parent.value === value) {
    const field = instanceMemberName(parent);
    return field === null ? null : { owner: parent.parent.parent, field };
  }
  if (
    parent?.type === AST_NODE_TYPES.AssignmentExpression &&
    WORKER_ASSIGNMENT_OPERATORS.has(parent.operator) &&
    parent.right === value
  ) {
    const field = thisField(parent.left);
    const owner = field === null ? null : thisClass(parent);
    return owner === null || field === null ? null : { owner, field };
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
 *
 * A close method may close the worker itself, through a local alias, or
 * through a helper it calls on `this` or `super`, and it may be inherited from
 * a base class declared in the same file. A class whose base comes from
 * elsewhere, or whose close method is abstract, may close the worker where the
 * rule cannot see, so it is not reported.
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
        'This class creates the BullMQ worker `this.{{field}}` but no {{methods}} method calls `this.{{field}}.close()`, so shutdown abandons its running jobs. Close it in `{{suggested}}`.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const { sourceCode } = context;
    const closeMethodNames = [...new Set(options.closeMethodNames ?? DEFAULT_CLOSE_METHOD_NAMES)];
    const methodList = closeMethodNames.map((name) => `\`${name}\``).join(' / ');
    const suggested = closeMethodNames.includes(PREFERRED_CLOSE_METHOD)
      ? PREFERRED_CLOSE_METHOD
      : (closeMethodNames[0] ?? PREFERRED_CLOSE_METHOD);
    const owned = new Map<ClassNode, OwnedWorker[]>();

    /** The class a `extends` clause names, when this file declares it; else null. */
    function declaredClass(node: TSESTree.Expression): ClassNode | null {
      const inner = stripTypeWrappers(node);
      if (inner.type === AST_NODE_TYPES.ClassExpression) return inner;
      if (inner.type !== AST_NODE_TYPES.Identifier) return null;
      const def = ASTUtils.findVariable(sourceCode.getScope(inner), inner)?.defs[0];
      if (def?.type === 'ClassName') return def.node;
      if (def?.type === 'Variable' && def.node.init !== null) {
        const init = stripTypeWrappers(def.node.init);
        if (init.type === AST_NODE_TYPES.ClassExpression) return init;
      }
      return null;
    }

    /** The class and the bases it inherits from, nearest first; null when a base is not declared in this file. */
    function classChain(owner: ClassNode): ClassNode[] | null {
      const chain: ClassNode[] = [];
      let current: ClassNode | null = owner;
      while (current !== null) {
        if (chain.includes(current)) return null;
        chain.push(current);
        if (current.superClass === null) return chain;
        current = declaredClass(current.superClass);
      }
      return null;
    }

    /**
     * The nearest instance method `name` in `chain` from index `start`: its
     * body, `'abstract'` when that declaration is abstract, or null.
     */
    function lookup(chain: readonly ClassNode[], start: number, name: string): MethodHit | 'abstract' | null {
      for (let level = start; level < chain.length; level += 1) {
        for (const member of chain[level]?.body.body ?? []) {
          if (instanceMemberName(member) !== name) continue;
          if (
            member.type === AST_NODE_TYPES.TSAbstractMethodDefinition ||
            member.type === AST_NODE_TYPES.TSAbstractPropertyDefinition
          ) {
            return 'abstract';
          }
          if (member.type === AST_NODE_TYPES.MethodDefinition && member.kind !== 'method') continue;
          if (member.type !== AST_NODE_TYPES.MethodDefinition && member.type !== AST_NODE_TYPES.PropertyDefinition) {
            continue;
          }
          const value = member.value;
          if (
            value?.type === AST_NODE_TYPES.FunctionExpression ||
            value?.type === AST_NODE_TYPES.ArrowFunctionExpression
          ) {
            return { fn: value, level };
          }
        }
      }
      return null;
    }

    /** The field a local holds when it was declared as `const w = this.w` or `const { w } = this`. */
    function aliasedField(identifier: TSESTree.Identifier): string | null {
      const def = ASTUtils.findVariable(sourceCode.getScope(identifier), identifier)?.defs[0];
      if (def?.type !== 'Variable' || def.node.init === null) return null;
      const { id, init } = def.node;
      if (id.type === AST_NODE_TYPES.Identifier) return thisField(init);
      if (id.type !== AST_NODE_TYPES.ObjectPattern || stripTypeWrappers(init).type !== AST_NODE_TYPES.ThisExpression) {
        return null;
      }
      for (const property of id.properties) {
        if (
          property.type !== AST_NODE_TYPES.Property ||
          property.computed ||
          property.key.type !== AST_NODE_TYPES.Identifier
        ) {
          continue;
        }
        const target = property.value.type === AST_NODE_TYPES.AssignmentPattern ? property.value.left : property.value;
        if (target === def.name) return property.key.name;
      }
      return null;
    }

    /**
     * The fields the class's close methods close, following helper calls on
     * `this` and `super`; null when a base outside this file or an abstract
     * method may close them where the rule cannot see.
     */
    function closedFields(owner: ClassNode): Set<string> | null {
      const chain = classChain(owner);
      if (chain === null) return null;
      const closed = new Set<string>();
      const seen = new Set<FunctionValue>();
      const queue: MethodHit[] = [];
      let unknown = false;

      function follow(hit: MethodHit | 'abstract' | null): void {
        if (hit === 'abstract') {
          unknown = true;
        } else if (hit !== null && !seen.has(hit.fn)) {
          seen.add(hit.fn);
          queue.push(hit);
        }
      }

      for (const name of closeMethodNames) follow(lookup(chain, 0, name));
      for (let hit = queue.pop(); hit !== undefined; hit = queue.pop()) {
        const level = hit.level;
        forEachDescendant(hit.fn.body, sourceCode.visitorKeys, (node) => {
          if (
            node.type !== AST_NODE_TYPES.CallExpression ||
            node.callee.type !== AST_NODE_TYPES.MemberExpression ||
            node.callee.computed ||
            node.callee.property.type !== AST_NODE_TYPES.Identifier
          ) {
            return;
          }
          const receiver = stripTypeWrappers(node.callee.object);
          const method = node.callee.property.name;
          if (method === 'close') {
            const field = receiver.type === AST_NODE_TYPES.Identifier ? aliasedField(receiver) : thisField(receiver);
            if (field !== null) closed.add(field);
          } else if (receiver.type === AST_NODE_TYPES.ThisExpression) {
            follow(lookup(chain, 0, method));
          } else if (receiver.type === AST_NODE_TYPES.Super) {
            follow(lookup(chain, level + 1, method));
          }
        });
      }
      return unknown ? null : closed;
    }

    function checkClass(owner: ClassNode): void {
      const workers = owned.get(owner);
      if (workers === undefined) return;
      owned.delete(owner);
      const closed = closedFields(owner);
      if (closed === null) return;
      for (const worker of workers) {
        if (closed.has(worker.field)) continue;
        context.report({
          node: worker.node,
          messageId: 'missingClose',
          data: { field: worker.field, methods: methodList, suggested },
        });
      }
    }

    return {
      NewExpression(node): void {
        if (!isBullmqNew(node, 'Worker', sourceCode.getScope(node))) return;
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
