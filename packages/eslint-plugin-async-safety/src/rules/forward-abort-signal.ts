import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeText, walk } from '../utils';

const RULE_NAME = 'forward-abort-signal';

type RuleOptions = [];
type MessageIds = 'unforwardedSignal';

/*
 * A function that accepts an AbortSignal — a parameter named `signal` or typed
 * `AbortSignal`, including the `{ signal }` destructured form — should forward it
 * to the cancellable work it does. This flags such a function when it `await`s a
 * call (or calls `fetch`) yet never passes the signal to any call: the signal is
 * accepted, maybe read for `.aborted`, but the actual I/O is left uncancellable.
 *
 * Conservative by construction:
 *   - fires ONLY when the body contains an awaited call or a `fetch(...)` (an
 *     operation that could have received the signal) — a pure `.aborted` polling
 *     loop with no awaited call is never flagged;
 *   - "forwarded" is any read of the signal binding that is not a member-access
 *     check (`signal.aborted`, `signal.throwIfAborted()`): passing it as an
 *     argument, into an options object, or assigning it away all count as forwarding,
 *     so the rule errs toward silence.
 * No fix — the correct call to thread it through is the author's choice.
 */

/** Collect the local binding names of any AbortSignal-shaped parameters. */
function signalBindingNames(params: readonly TSESTree.Parameter[]): {
  names: Set<string>;
  reportNode: TSESTree.Node | null;
} {
  const names = new Set<string>();
  let reportNode: TSESTree.Node | null = null;

  const consider = (name: string, node: TSESTree.Node): void => {
    names.add(name);
    reportNode ??= node;
  };

  for (const rawParam of params) {
    let param: TSESTree.Node = rawParam;
    if (param.type === AST_NODE_TYPES.AssignmentPattern) {
      param = param.left; // `signal = ...` default.
    }
    if (param.type === AST_NODE_TYPES.Identifier) {
      const typedAbortSignal =
        param.typeAnnotation?.typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
        param.typeAnnotation.typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
        param.typeAnnotation.typeAnnotation.typeName.name === 'AbortSignal';
      if (param.name === 'signal' || typedAbortSignal) {
        consider(param.name, param);
      }
      continue;
    }
    if (param.type === AST_NODE_TYPES.ObjectPattern) {
      for (const property of param.properties) {
        if (
          property.type !== AST_NODE_TYPES.Property ||
          property.key.type !== AST_NODE_TYPES.Identifier ||
          property.key.name !== 'signal'
        ) {
          continue;
        }
        let value: TSESTree.Node = property.value;
        if (value.type === AST_NODE_TYPES.AssignmentPattern) {
          value = value.left;
        }
        if (value.type === AST_NODE_TYPES.Identifier) {
          consider(value.name, property);
        }
      }
    }
  }

  return { names, reportNode };
}

/** The function body contains an awaited call or a direct `fetch(...)` call. */
function hasCancellableWork(fn: TSESTree.Node): boolean {
  let found = false;
  walk(fn, (node) => {
    if (found) {
      return;
    }
    if (
      node.type === AST_NODE_TYPES.AwaitExpression &&
      node.argument.type === AST_NODE_TYPES.CallExpression
    ) {
      found = true;
      return;
    }
    if (node.type === AST_NODE_TYPES.CallExpression && calleeText(node.callee) === 'fetch') {
      found = true;
    }
  });
  return found;
}

/** A read that is the object of a member access (`signal.aborted`) is a check, not a forward. */
function isCheckOnlyRead(identifier: TSESTree.Identifier): boolean {
  const parent = identifier.parent;
  return parent.type === AST_NODE_TYPES.MemberExpression && parent.object === identifier;
}

export const forwardAbortSignalRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A function that accepts an `AbortSignal` (param named `signal` or typed `AbortSignal`) but awaits a call without ever forwarding it leaves that work uncancellable.',
    },
    schema: [],
    messages: {
      unforwardedSignal:
        '`{{name}}` is an AbortSignal but is never forwarded to a call in this function — thread it into the awaited work (e.g. `fetch(url, { signal })`) so the operation can be cancelled.',
    },
  },
  defaultOptions: [],
  create(context) {
    function check(fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression): void {
      const { names, reportNode } = signalBindingNames(fn.params);
      if (names.size === 0 || reportNode === null) {
        return;
      }
      if (!hasCancellableWork(fn)) {
        return;
      }

      const declared = context.sourceCode.getDeclaredVariables(fn);
      for (const variable of declared) {
        if (!names.has(variable.name)) {
          continue;
        }
        const reads = variable.references.filter((ref) => ref.isRead());
        const forwarded = reads.some(
          (ref) =>
            ref.identifier.type === AST_NODE_TYPES.Identifier &&
            !isCheckOnlyRead(ref.identifier),
        );
        if (!forwarded) {
          context.report({
            node: reportNode,
            messageId: 'unforwardedSignal',
            data: { name: variable.name },
          });
          return; // one report per function is enough.
        }
      }
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
});
