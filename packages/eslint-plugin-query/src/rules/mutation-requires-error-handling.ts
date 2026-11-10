import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeName, staticName } from '../utils/ast';

const RULE_NAME = 'mutation-requires-error-handling';

export interface MutationRequiresErrorHandlingOptions {
  /** Hooks that create a mutation. */
  readonly hooks?: readonly string[];
  /** Option keys that count as handling the error where the mutation is defined. */
  readonly handledBy?: readonly string[];
}

type RuleOptions = [MutationRequiresErrorHandlingOptions];
type MessageIds = 'unhandled';

const DEFAULT_HOOKS: readonly string[] = ['useMutation'];
const DEFAULT_HANDLED_BY: readonly string[] = ['onError', 'throwOnError', 'useErrorBoundary'];

/** Methods on a mutation result that start it. */
const MUTATE = new Set(['mutate', 'mutateAsync']);
/** Result fields a component reads to show the failure. */
const ERROR_STATE = new Set(['error', 'isError', 'status', 'failureReason', 'failureCount']);

type Scope = TSESLint.Scope.Scope;

/** What the definition says about error handling. */
type Definition = 'handled' | 'unhandled' | 'unknown';

function isUndefined(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Identifier && node.name === 'undefined';
}

/**
 * Whether an options object literal handles errors: a `handledBy` key whose
 * value is not `undefined` or `false`. A spread may carry one, so it makes the
 * answer unknown rather than unhandled.
 */
function readOptionsObject(
  options: TSESTree.ObjectExpression,
  handledBy: ReadonlySet<string>,
): Definition {
  let spread = false;
  for (const property of options.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      spread = true;
      continue;
    }
    const name = staticName(property.key, property.computed);
    if (name === undefined || !handledBy.has(name)) continue;
    const value = property.value;
    const off =
      isUndefined(value) || (value.type === AST_NODE_TYPES.Literal && value.value === false);
    if (!off) return 'handled';
  }
  return spread ? 'unknown' : 'unhandled';
}

/**
 * Resolve the hook's options to an object literal: inline, through tRPC's
 * `trpc.x.mutationOptions({...})`, or through a `const` in scope holding either.
 * Anything else (a parameter, an import, a call to your own factory) is unknown.
 */
function readDefinition(
  argument: TSESTree.Node | undefined,
  scope: Scope,
  handledBy: ReadonlySet<string>,
  depth = 0,
): Definition {
  if (argument === undefined) return 'unhandled';
  if (argument.type === AST_NODE_TYPES.ObjectExpression) {
    return readOptionsObject(argument, handledBy);
  }
  if (argument.type === AST_NODE_TYPES.CallExpression && calleeName(argument) === 'mutationOptions') {
    return readDefinition(argument.arguments[0], scope, handledBy, depth + 1);
  }
  if (argument.type === AST_NODE_TYPES.Identifier && depth < 3) {
    const def = ASTUtils.findVariable(scope, argument)?.defs[0];
    if (
      def?.type === 'Variable' &&
      def.parent.kind === 'const' &&
      def.node.id.type === AST_NODE_TYPES.Identifier &&
      def.node.init != null
    ) {
      return readDefinition(def.node.init, scope, handledBy, depth + 1);
    }
  }
  return 'unknown';
}

/** `x`, `x as T`, `x!`: the expression under TypeScript wrappers and `await`. */
function outerExpression(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.parent?.type === AST_NODE_TYPES.TSAsExpression ||
    current.parent?.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.parent?.type === AST_NODE_TYPES.AwaitExpression ||
    current.parent?.type === AST_NODE_TYPES.ChainExpression
  ) {
    current = current.parent;
  }
  return current;
}

/** True when `node` sits in the block of a `try` that has a `catch`, with no function in between. */
function insideTryWithCatch(node: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  for (let current = node.parent; current != null; current = current.parent) {
    if (
      current.type === AST_NODE_TYPES.FunctionDeclaration ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression
    ) {
      return false;
    }
    if (current.type === AST_NODE_TYPES.TryStatement && current.block === child) {
      return current.handler != null;
    }
    child = current;
  }
  return false;
}

/**
 * Whether one call that starts the mutation handles its error at the call:
 * `mutate(vars, { onError })`, or a `mutateAsync` that is awaited in a `try`,
 * chained with `.catch`/`.then(ok, fail)`, or handed on (returned, passed,
 * assigned) for someone else to handle.
 */
function callHandles(call: TSESTree.CallExpression, method: string): boolean {
  if (method === 'mutate') {
    const perCall = call.arguments[1];
    if (perCall === undefined) return false;
    if (perCall.type !== AST_NODE_TYPES.ObjectExpression) return true;
    return readOptionsObject(perCall, new Set(['onError'])) !== 'unhandled';
  }
  if (insideTryWithCatch(call)) return true;
  const outer = outerExpression(call);
  const parent = outer.parent;
  if (parent === undefined) return false;
  if (
    parent.type === AST_NODE_TYPES.MemberExpression &&
    parent.object === outer &&
    !parent.computed &&
    parent.property.type === AST_NODE_TYPES.Identifier &&
    (parent.property.name === 'catch' ||
      (parent.property.name === 'then' &&
        parent.parent.type === AST_NODE_TYPES.CallExpression &&
        parent.parent.arguments.length > 1))
  ) {
    return true;
  }
  // `void m.mutateAsync()` and a bare statement drop the rejection.
  if (parent.type === AST_NODE_TYPES.ExpressionStatement) return false;
  if (parent.type === AST_NODE_TYPES.UnaryExpression && parent.operator === 'void') return false;
  return true;
}

interface Usage {
  /** At least one start of the mutation was seen. */
  calls: number;
  /** A start that handles its error, or a read of the error state. */
  handled: boolean;
  /** The result escapes where this rule cannot follow it. */
  escapes: boolean;
}

/** Examine every reference to a variable bound to the whole mutation result. */
function examineResult(variable: TSESLint.Scope.Variable, usage: Usage): void {
  for (const reference of variable.references) {
    if (reference.init === true) continue;
    const id = reference.identifier;
    const parent = id.parent;
    if (
      parent?.type === AST_NODE_TYPES.MemberExpression &&
      parent.object === id &&
      !parent.computed &&
      parent.property.type === AST_NODE_TYPES.Identifier
    ) {
      const member = parent.property.name;
      if (ERROR_STATE.has(member)) {
        usage.handled = true;
      } else if (MUTATE.has(member) && parent.parent.type === AST_NODE_TYPES.CallExpression) {
        usage.calls += 1;
        if (callHandles(parent.parent, member)) usage.handled = true;
      } else if (MUTATE.has(member)) {
        // `onClick={m.mutate}` or `const run = m.mutateAsync`: followed no further.
        usage.escapes = true;
      }
      continue;
    }
    usage.escapes = true;
  }
}

/** Examine a destructured field (`mutate`, `mutateAsync`, `error`, ...) of the result. */
function examineField(name: string, variable: TSESLint.Scope.Variable, usage: Usage): void {
  if (ERROR_STATE.has(name)) {
    usage.handled = true;
    return;
  }
  if (!MUTATE.has(name)) return;
  for (const reference of variable.references) {
    if (reference.init === true) continue;
    const id = reference.identifier;
    const parent = id.parent;
    if (parent?.type === AST_NODE_TYPES.CallExpression && parent.callee === id) {
      usage.calls += 1;
      if (callHandles(parent, name)) usage.handled = true;
    } else {
      usage.escapes = true;
    }
  }
}

/*
 * A mutation that fails with no `onError` at its definition, none at the call
 * and nothing reading its error state fails silently: the button stops
 * spinning and the user believes the save went through.
 *
 * The rule resolves before it reports, because the grep version of this check
 * drowned in false positives. It reads the hook's options through inline
 * objects, tRPC's `mutationOptions({...})` and local `const`s; it follows the
 * result through the variable it is bound to (whole or destructured) to every
 * `mutate` / `mutateAsync` call and every read of `error` / `isError` /
 * `status`; and it stays silent whenever the answer is unknown: options it
 * cannot resolve, a result that is returned from a custom hook or passed
 * along, a `mutate` handed to a prop.
 */
export const mutationRequiresErrorHandlingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a TanStack Query mutation to handle its error somewhere visible: `onError` on the hook, `onError` or a `catch` at the call, or a read of its error state.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          hooks: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Hooks that create a mutation, matched on the last segment of the callee (`useMutation`, `trpc.post.create.useMutation`). Default `["useMutation"]`.',
          },
          handledBy: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Option keys that count as handling the error where the mutation is defined. Default `["onError", "throwOnError", "useErrorBoundary"]`.',
          },
        },
      },
    ],
    messages: {
      unhandled:
        'This mutation has no error handling: no `onError` on the hook, none at the call, no `catch` around `mutateAsync`, and nothing reads its `error`. A failed request goes unnoticed. Handle it at one of those places.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const hooks = new Set(options.hooks ?? DEFAULT_HOOKS);
    const handledBy = new Set(options.handledBy ?? DEFAULT_HANDLED_BY);

    return {
      CallExpression(node): void {
        const hook = calleeName(node);
        if (hook === undefined || !hooks.has(hook)) return;

        const scope = context.sourceCode.getScope(node);
        if (readDefinition(node.arguments[0], scope, handledBy) !== 'unhandled') return;

        const outer = outerExpression(node);
        const declarator = outer.parent;
        // Returned from a custom hook, passed to a function, spread into an
        // object: the caller may handle it, so the rule cannot say.
        if (declarator?.type !== AST_NODE_TYPES.VariableDeclarator || declarator.init !== outer) {
          return;
        }

        const usage: Usage = { calls: 0, handled: false, escapes: false };
        const declared = context.sourceCode.getDeclaredVariables(declarator);
        if (declarator.id.type === AST_NODE_TYPES.Identifier) {
          const variable = declared[0];
          if (variable === undefined) return;
          examineResult(variable, usage);
        } else if (declarator.id.type === AST_NODE_TYPES.ObjectPattern) {
          for (const property of declarator.id.properties) {
            if (property.type === AST_NODE_TYPES.RestElement) {
              usage.escapes = true;
              continue;
            }
            const key = staticName(property.key, property.computed);
            const variable = declared.find((candidate) =>
              candidate.defs.some((def) => def.name === property.value),
            );
            if (key === undefined || variable === undefined) {
              usage.escapes = true;
              continue;
            }
            examineField(key, variable, usage);
          }
        } else {
          return;
        }

        if (usage.handled || usage.escapes) return;
        context.report({ node, messageId: 'unhandled' });
      },
    };
  },
});

