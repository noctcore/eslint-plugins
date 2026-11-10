import { walkSome } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'ipc-handler-validates-sender';

export interface IpcHandlerValidatesSenderOptions {
  /** Functions that check the sender; when set, the first statement must call one with the event. */
  readonly guards?: readonly string[];
  /** Identifiers that name the main-process IPC module. */
  readonly receivers?: readonly string[];
}

type RuleOptions = [IpcHandlerValidatesSenderOptions];
type MessageIds = 'noEventParameter' | 'noBlockBody' | 'notFirst';

const REGISTRATIONS = new Set(['handle', 'handleOnce', 'on', 'once']);
const DEFAULT_RECEIVERS: readonly string[] = ['ipcMain'];

type Handler = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

/** The names a handler's first parameter binds: `event`, or `{ senderFrame }`. */
function eventNames(handler: Handler): Set<string> {
  const names = new Set<string>();
  let param: TSESTree.Node | undefined = handler.params[0];
  if (param?.type === AST_NODE_TYPES.AssignmentPattern) param = param.left;
  if (param?.type === AST_NODE_TYPES.Identifier) {
    names.add(param.name);
  } else if (param?.type === AST_NODE_TYPES.ObjectPattern) {
    for (const property of param.properties) {
      const value = property.type === AST_NODE_TYPES.Property ? property.value : property.argument;
      if (value.type === AST_NODE_TYPES.Identifier) names.add(value.name);
    }
  }
  return names;
}

/** The callee name of `guard(...)` or `this.security.guard(...)`, else null. */
function calledName(call: TSESTree.CallExpression): string | null {
  const callee = call.callee;
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

/*
 * Every IPC handler in the main process checks who sent the message before it
 * does anything. An IPC channel is a direct call from a renderer into code
 * that runs with Node and the operating system, and any frame in the app can
 * send on it: an iframe, a page navigated to by mistake, remote content added
 * by a later feature. The Electron security checklist asks for the sender
 * (`event.senderFrame`) to be validated on every message.
 *
 * "First" matters: a check placed after an await, a store read or a dialog
 * has already done what it was meant to prevent. A handler passed by name is
 * not followed; write it inline or check it where it is defined.
 */
export const ipcHandlerValidatesSenderRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every inline `ipcMain.handle` / `ipcMain.on` handler to check its sender (`event.senderFrame`) in its first statement, before it does anything else.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          guards: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Functions that validate the sender. When set, the first statement must call one of them with the event; unset, any first statement that reads the event counts.',
          },
          receivers: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description: 'Identifiers that name the main-process IPC module. Default `["ipcMain"]`.',
          },
        },
      },
    ],
    messages: {
      noEventParameter:
        "This IPC handler takes no event, so it cannot check its sender. Take the event first and validate `event.senderFrame` before doing anything: any frame in the app can send on '{{channel}}'.",
      noBlockBody:
        "Give this IPC handler a block body whose first statement checks the sender: any frame in the app can send on '{{channel}}'.",
      notFirst:
        "Check the sender in this IPC handler's first statement (for example `if (!isTrustedSender(event.senderFrame)) throw new Error('Forbidden sender')`). Any frame in the app can send on '{{channel}}', and a check after other work comes too late.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const receivers = new Set(options.receivers ?? DEFAULT_RECEIVERS);
    const guards = options.guards === undefined ? null : new Set(options.guards);
    const visitorKeys = context.sourceCode.visitorKeys;

    function checksSender(statement: TSESTree.Statement, names: ReadonlySet<string>): boolean {
      const readsEvent = (node: TSESTree.Node): boolean =>
        node.type === AST_NODE_TYPES.Identifier && names.has(node.name);
      if (guards === null) return walkSome(statement, visitorKeys, readsEvent);
      return walkSome(
        statement,
        visitorKeys,
        (node) =>
          node.type === AST_NODE_TYPES.CallExpression &&
          guards.has(calledName(node) ?? '') &&
          node.arguments.some((argument) => walkSome(argument, visitorKeys, readsEvent)),
      );
    }

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.object.type !== AST_NODE_TYPES.Identifier ||
          !receivers.has(callee.object.name) ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !REGISTRATIONS.has(callee.property.name)
        ) {
          return;
        }
        const [channelNode, handler] = node.arguments;
        if (
          handler?.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          handler?.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return;
        }
        const channel =
          channelNode?.type === AST_NODE_TYPES.Literal && typeof channelNode.value === 'string'
            ? channelNode.value
            : '?';

        const names = eventNames(handler);
        if (names.size === 0) {
          context.report({ node: handler, messageId: 'noEventParameter', data: { channel } });
          return;
        }
        if (handler.body.type !== AST_NODE_TYPES.BlockStatement) {
          context.report({ node: handler, messageId: 'noBlockBody', data: { channel } });
          return;
        }
        const [first] = handler.body.body;
        if (first === undefined || !checksSender(first, names)) {
          context.report({ node: first ?? handler, messageId: 'notFirst', data: { channel } });
        }
      },
    };
  },
});
