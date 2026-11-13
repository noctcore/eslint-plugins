import { forEachDescendant, type VisitorKeys } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/** Default receiver pattern: `this.queue`, `emailQueue`, `this.billingQueue`. */
export const DEFAULT_QUEUE_PATTERN = 'queue';

/** JSON schema of the shared `queuePattern` option. */
export const queuePatternSchema = {
  type: 'string',
  minLength: 1,
  description:
    'Case-insensitive regular expression a receiver name must match to count as a BullMQ queue (`this.<name>` or a bare `<name>`). Default `queue`.',
} as const;

/** Compile the `queuePattern` option. */
export function queuePatternRegExp(pattern: string | undefined): RegExp {
  return new RegExp(pattern ?? DEFAULT_QUEUE_PATTERN, 'iu');
}

/**
 * Whether a call's receiver names a BullMQ queue: `this.<name>`, `a.b.<name>`
 * or a bare identifier whose name matches the pattern. A heuristic with no type
 * information, shared by the queue rules so they police the same calls.
 */
export function receiverLooksLikeQueue(object: TSESTree.Node, pattern: RegExp): boolean {
  if (
    object.type === AST_NODE_TYPES.MemberExpression &&
    !object.computed &&
    object.property.type === AST_NODE_TYPES.Identifier
  ) {
    return pattern.test(object.property.name);
  }
  if (object.type === AST_NODE_TYPES.Identifier) {
    return pattern.test(object.name);
  }
  return false;
}

/**
 * The method name of `<queue>.<method>(...)` when the receiver looks like a
 * queue, else null.
 */
export function queueMethod(node: TSESTree.CallExpression, pattern: RegExp): string | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    !receiverLooksLikeQueue(callee.object, pattern)
  ) {
    return null;
  }
  return callee.property.name;
}

/** The name of a non-computed property key (`a:` or `'a':`), else null. */
export function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

/** A direct, plainly keyed property of an object literal, or undefined. */
export function directProperty(
  node: TSESTree.Node | undefined,
  name: string,
): TSESTree.Property | undefined {
  if (node?.type !== AST_NODE_TYPES.ObjectExpression) return undefined;
  return node.properties.find(
    (member): member is TSESTree.Property =>
      member.type === AST_NODE_TYPES.Property && propertyName(member) === name,
  );
}

/** The job objects of an `addBulk` argument: the object literals holding `data`. */
export function bulkJobs(
  argument: TSESTree.Node,
  visitorKeys: VisitorKeys,
): TSESTree.ObjectExpression[] {
  const jobs: TSESTree.ObjectExpression[] = [];
  forEachDescendant(argument, visitorKeys, (node) => {
    if (
      node.type === AST_NODE_TYPES.ObjectExpression &&
      node.properties.some(
        (property) => property.type === AST_NODE_TYPES.Property && propertyName(property) === 'data',
      )
    ) {
      jobs.push(node);
    }
  });
  return jobs;
}

/** True for the identifier `undefined`. */
export function isUndefined(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Identifier && node.name === 'undefined';
}

/** The decorator's name for `@Name(...)` and `@ns.Name(...)`, else null. */
export function decoratorCallName(decorator: TSESTree.Decorator): string | null {
  const expression = decorator.expression;
  if (expression.type !== AST_NODE_TYPES.CallExpression) return null;
  const callee = expression.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) return callee.name;
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
}
