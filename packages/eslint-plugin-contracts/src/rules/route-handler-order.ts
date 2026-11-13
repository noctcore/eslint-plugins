import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { middlewarePath, routeCall } from '../utils/router';

const RULE_NAME = 'route-handler-order';

export interface RouteHandlerGroup {
  /** Group name, used in reports. */
  readonly name: string;
  /** Dotted names that put an argument in this group. */
  readonly callees: readonly string[];
}

export interface RouteHandlerOrderOptions {
  /** Ordered groups; an argument must not follow an argument of a later group. */
  readonly groups: readonly RouteHandlerGroup[];
}

type RuleOptions = [RouteHandlerOrderOptions];
type MessageIds = 'outOfOrder';

/*
 * In a router method chain the order of middleware is behaviour: an auth check
 * placed after a body validator answers a signed-out caller with a bad body 400
 * instead of 401, and a docs middleware placed after the handler is never
 * reached. Teams settle on one order, and this rule enforces it.
 *
 * INERT UNTIL CONFIGURED: `groups` is an ordered list of named groups, each with
 * the dotted callee names that belong to it. Without groups the rule reports
 * nothing; there is no universal order to hard-code.
 *
 * Every argument between the path and the last one is classified by its dotted
 * name (`signedInOnly`, `auth.signedIn`, or the callee of `body(S)`). The last
 * argument is the handler and is never classified. An argument that matches no
 * group is skipped and does not reset the order. The highest group seen so far
 * is kept, and any later argument of a lower group is reported once.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      description:
        'Ordered groups of route arguments. An argument may not follow an argument of a later group.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'callees'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: 'Group name, used in reports.',
          },
          callees: {
            type: 'array',
            minItems: 1,
            description:
              'Dotted names that put an argument in this group, matched exactly against a bare reference or a call callee.',
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

export const routeHandlerOrderRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require the middleware arguments of a route method call to follow a configured group order (for example docs, auth, validation), with the handler last.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      outOfOrder:
        '`{{argument}}` is in group `{{group}}`, which goes before `{{laterGroup}}`. Move it ahead of the `{{laterGroup}}` arguments.',
    },
  },
  defaultOptions: [{ groups: [] }],
  create(context, [options]) {
    const groups = options.groups;
    if (groups.length === 0) {
      return {};
    }

    const groupOf = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const callee of group.callees) {
        if (!groupOf.has(callee)) {
          groupOf.set(callee, index);
        }
      }
    });

    return {
      CallExpression(node): void {
        const route = routeCall(node);
        if (route === null) {
          return;
        }
        let highest = -1;
        for (const arg of route.chain.slice(0, -1)) {
          const path = middlewarePath(arg);
          const index = path === null ? undefined : groupOf.get(path);
          if (path === null || index === undefined) {
            continue;
          }
          if (index < highest) {
            context.report({
              node: arg,
              messageId: 'outOfOrder',
              data: {
                argument: path,
                group: groups[index]?.name ?? '',
                laterGroup: groups[highest]?.name ?? '',
              },
            });
          } else {
            highest = index;
          }
        }
      },
    };
  },
});
