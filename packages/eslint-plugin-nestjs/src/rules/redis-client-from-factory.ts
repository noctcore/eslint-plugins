import { calleeName, fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { isBullmqNew, stripTypeWrappers } from '../utils/bullmq';
import { directProperty } from '../utils/queue';

const RULE_NAME = 'redis-client-from-factory';

export interface RedisClientFromFactoryOptions {
  /** Names of the functions that build the Redis connection options. Required: with none, the rule reports nothing. */
  readonly factoryFunctions?: readonly string[];
  /** Class names whose `new` expressions are checked. Replaces the default `Redis`, `IORedis`. */
  readonly clientClasses?: readonly string[];
  /** Globs of files where inline options are allowed. Replaces the default list of test files. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [RedisClientFromFactoryOptions];
type MessageIds = 'inlineClient' | 'inlineConnection';

const DEFAULT_CLIENT_CLASSES: readonly string[] = ['Redis', 'IORedis'];

const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/__tests__/**',
];

type ArgumentKind = 'factory' | 'inline' | 'unknown';

function isFactoryCall(node: TSESTree.Node, factories: ReadonlySet<string>): boolean {
  const stripped = stripTypeWrappers(node);
  if (stripped.type !== AST_NODE_TYPES.CallExpression) return false;
  const name = calleeName(stripped.callee);
  return name !== null && factories.has(name);
}

function hasFactorySpread(
  object: TSESTree.ObjectExpression,
  factories: ReadonlySet<string>,
): boolean {
  return object.properties.some(
    (property) =>
      property.type === AST_NODE_TYPES.SpreadElement && isFactoryCall(property.argument, factories),
  );
}

function classifyClientArgument(
  argument: TSESTree.CallExpressionArgument,
  factories: ReadonlySet<string>,
): ArgumentKind {
  const node = stripTypeWrappers(argument);
  if (isFactoryCall(node, factories)) return 'factory';
  switch (node.type) {
    case AST_NODE_TYPES.ObjectExpression:
      return hasFactorySpread(node, factories) ? 'factory' : 'inline';
    case AST_NODE_TYPES.Literal:
    case AST_NODE_TYPES.TemplateLiteral:
    case AST_NODE_TYPES.CallExpression:
      return 'inline';
    default:
      return 'unknown';
  }
}

/*
 * A Redis connection built from a literal host, port or URL drifts from the
 * rest of the app: one place gets a TLS flag or a retry setting and the others
 * do not. Every client, and every BullMQ `connection` written inline, takes
 * its options from one configured factory call, directly or as a spread. A
 * variable or member expression is not followed, and only the bullmq `Queue`
 * and `Worker` classes are checked for `connection`.
 */
export const redisClientFromFactoryRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every Redis client and every inline BullMQ `connection` to take its options from a configured factory function, not from literal host, port or URL values.',
      requiresOptions: true,
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          factoryFunctions: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
            description:
              'Names of the functions that build the connection options, matched on the callee name (`getRedisOptions()` and `this.redis.getRedisOptions()` both match). The rule does nothing until this is set.',
          },
          clientClasses: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
            description:
              'Class names whose `new` expressions are checked, matched on the callee identifier. Replaces the default list: `Redis`, `IORedis`.',
          },
          allowIn: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Globs of files where inline options are allowed, such as the module that defines the factory. Replaces the default list of test files.',
          },
        },
      },
    ],
    messages: {
      inlineClient:
        'This `new {{name}}(...)` does not take its options from a configured factory function. Build them with one of the factory functions so every connection shares one setup. The module that defines the factory belongs in `allowIn`.',
      inlineConnection:
        'This inline BullMQ `connection` does not take its options from a configured factory function. Build them with one of the factory functions so every connection shares one setup. The module that defines the factory belongs in `allowIn`.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const allowIn = resolveAllowIn(options, [], DEFAULT_ALLOW_IN);
    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd)) return {};

    const factories: ReadonlySet<string> = new Set(options.factoryFunctions ?? []);
    if (factories.size === 0) return {};
    const classes: ReadonlySet<string> = new Set(options.clientClasses ?? DEFAULT_CLIENT_CLASSES);

    function checkClient(node: TSESTree.NewExpression, name: string): void {
      if (node.arguments.length === 0) {
        context.report({ node, messageId: 'inlineClient', data: { name } });
        return;
      }
      const kinds = node.arguments.map((argument) => classifyClientArgument(argument, factories));
      if (kinds.includes('factory') || kinds.includes('unknown')) return;
      context.report({ node, messageId: 'inlineClient', data: { name } });
    }

    function checkConnection(node: TSESTree.NewExpression, optionsIndex: number): void {
      if (node.arguments.some((argument) => argument.type === AST_NODE_TYPES.SpreadElement)) return;
      const argument = node.arguments[optionsIndex];
      if (argument === undefined) return;
      const optionsNode = stripTypeWrappers(argument);
      if (optionsNode.type !== AST_NODE_TYPES.ObjectExpression) return;
      const property = directProperty(optionsNode, 'connection');
      if (property === undefined || property.shorthand) return;
      const value = stripTypeWrappers(property.value);
      if (value.type !== AST_NODE_TYPES.ObjectExpression || hasFactorySpread(value, factories)) return;
      context.report({ node: value, messageId: 'inlineConnection' });
    }

    return {
      NewExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && classes.has(node.callee.name)) {
          checkClient(node, node.callee.name);
        }
        const scope = context.sourceCode.getScope(node);
        if (isBullmqNew(node, 'Queue', scope)) checkConnection(node, 1);
        else if (isBullmqNew(node, 'Worker', scope)) checkConnection(node, 2);
      },
    };
  },
});
