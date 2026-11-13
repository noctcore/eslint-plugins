import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { middlewarePath, routeCall } from '../utils/router';

const RULE_NAME = 'describe-auth-matches-middleware';

export interface DescribeAuthMatchesMiddlewareOptions {
  /** Dotted name of the docs call; defaults to `describe`. */
  readonly docsCallee?: string;
  /** Property of the docs call's first object argument that names the auth kind; defaults to `auth`. */
  readonly authProperty?: string;
  /** Auth kind to the dotted middleware names that satisfy it; an empty list means none is needed. */
  readonly map?: Readonly<Record<string, readonly string[]>>;
}

type RuleOptions = [DescribeAuthMatchesMiddlewareOptions];
type MessageIds = 'missingMiddleware' | 'foreignMiddleware' | 'unknownKind';

/*
 * A route's docs call declares an auth kind (`describe({ auth: 'session' })`)
 * that feeds the generated security entry, while the middleware in the same
 * chain is what enforces it. When the two disagree, the published contract
 * lies about the real behaviour. This rule reads both from one route call and
 * reports the disagreement.
 *
 * INERT UNTIL CONFIGURED: `map` lists, for each auth kind, the dotted
 * middleware names that satisfy it. Without a map the rule reports nothing,
 * because no middleware name is universal.
 *
 * Only the arguments between the path and the last one are read; the last
 * argument is the handler. The docs call is the first of them whose dotted
 * name is `docsCallee`. A route is skipped when its chain has a spread
 * argument, when it has no docs call, or when the kind is not a string literal.
 * A kind that is not a key of `map` is reported as unknown. A kind with a
 * non-empty list needs any one of its names in the chain. Any middleware named
 * under another kind and not under the declared one is reported. Middleware
 * named in no map entry is ignored.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docsCallee: {
      type: 'string',
      minLength: 1,
      description:
        'Dotted name of the docs call among the route arguments. Defaults to `describe`.',
    },
    authProperty: {
      type: 'string',
      minLength: 1,
      description:
        'Property of the docs call first object argument that names the auth kind. Defaults to `auth`.',
    },
    map: {
      type: 'object',
      description:
        'Maps each auth kind to the dotted middleware names that satisfy it. Any one name in the list is enough; an empty list means the kind needs no middleware.',
      additionalProperties: {
        type: 'array',
        description:
          'Dotted middleware names, matched exactly against a bare reference or a call callee.',
        items: { type: 'string', minLength: 1 },
      },
    },
  },
};

function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

function declaredKind(
  docsCall: TSESTree.CallExpression,
  authProperty: string,
): TSESTree.StringLiteral | null {
  const [first] = docsCall.arguments;
  if (first === undefined || first.type !== AST_NODE_TYPES.ObjectExpression) {
    return null;
  }
  for (const property of first.properties) {
    if (property.type !== AST_NODE_TYPES.Property || propertyName(property) !== authProperty) {
      continue;
    }
    const value = property.value;
    if (value.type === AST_NODE_TYPES.Literal && typeof value.value === 'string') {
      return value as TSESTree.StringLiteral;
    }
    return null;
  }
  return null;
}

function quoted(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(', ');
}

export const describeAuthMatchesMiddlewareRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the auth kind a route docs call declares to match the middleware in the same route chain, using a configured map from kind to middleware names.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      missingMiddleware:
        'The docs declare auth `{{kind}}`, but the chain has none of {{expected}}. Add one before the handler or change the declared kind.',
      foreignMiddleware:
        '`{{middleware}}` is mapped to {{otherKinds}}, not to the declared auth `{{kind}}`.',
      unknownKind: 'The docs declare auth `{{kind}}`, which is not a key of `map`.',
    },
  },
  defaultOptions: [{ docsCallee: 'describe', authProperty: 'auth', map: {} }],
  create(context, [options]) {
    const docsCallee = options.docsCallee ?? 'describe';
    const authProperty = options.authProperty ?? 'auth';
    const kinds = new Map<string, readonly string[]>(Object.entries(options.map ?? {}));
    if (kinds.size === 0) {
      return {};
    }

    const kindsOf = new Map<string, string[]>();
    for (const [kind, names] of kinds) {
      for (const name of names) {
        const listed = kindsOf.get(name);
        if (listed === undefined) {
          kindsOf.set(name, [kind]);
        } else {
          listed.push(kind);
        }
      }
    }

    return {
      CallExpression(node): void {
        const route = routeCall(node);
        if (route === null) {
          return;
        }
        if (route.chain.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) {
          return;
        }
        const before = route.chain.slice(0, -1);
        const docsCall = before.find(
          (arg): arg is TSESTree.CallExpression =>
            arg.type === AST_NODE_TYPES.CallExpression && middlewarePath(arg) === docsCallee,
        );
        if (docsCall === undefined) {
          return;
        }
        const kindNode = declaredKind(docsCall, authProperty);
        if (kindNode === null) {
          return;
        }
        const kind = kindNode.value;
        const accepted = kinds.get(kind);
        if (accepted === undefined) {
          context.report({ node: kindNode, messageId: 'unknownKind', data: { kind } });
          return;
        }

        const present = new Set<string>();
        for (const arg of before) {
          if (arg === docsCall) {
            continue;
          }
          const name = middlewarePath(arg);
          if (name === null) {
            continue;
          }
          present.add(name);
          const owners = kindsOf.get(name);
          if (owners !== undefined && !accepted.includes(name)) {
            context.report({
              node: arg,
              messageId: 'foreignMiddleware',
              data: { middleware: name, kind, otherKinds: quoted(owners) },
            });
          }
        }

        if (accepted.length > 0 && !accepted.some((name) => present.has(name))) {
          context.report({
            node: kindNode,
            messageId: 'missingMiddleware',
            data: { kind, expected: quoted(accepted) },
          });
        }
      },
    };
  },
});
