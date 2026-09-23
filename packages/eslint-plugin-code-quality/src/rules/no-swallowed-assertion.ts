import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'no-swallowed-assertion';

type MessageIds = 'swallowedInCatch' | 'swallowedInPromiseCatch';

/** Callees whose callback is a test or hook body: the search for a `try` stops there. */
const RUNNERS = new Set(['it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

/** The async matcher modifiers that make an `expect(...)` chain a promise. */
const ASYNC_MODIFIERS = new Set(['rejects', 'resolves']);

const LOOP_TYPES = new Set<AST_NODE_TYPES>([
  AST_NODE_TYPES.ForStatement,
  AST_NODE_TYPES.ForInStatement,
  AST_NODE_TYPES.ForOfStatement,
  AST_NODE_TYPES.WhileStatement,
  AST_NODE_TYPES.DoWhileStatement,
]);

type FunctionNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionExpression
  | TSESTree.FunctionDeclaration;

interface SwallowingTry {
  readonly node: TSESTree.TryStatement;
  readonly handler: TSESTree.CatchClause;
  /** The test or hook callback the `try` runs in. */
  readonly boundary: FunctionNode;
}

function isFunctionNode(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
}

/** Root identifier of a runner callee: `it`, `test.each(table)`, `test.step`. */
function runnerName(callee: TSESTree.Node): string | null {
  let current: TSESTree.Node = callee;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.CallExpression) {
      current = current.callee;
    } else if (current.type === AST_NODE_TYPES.TaggedTemplateExpression) {
      current = current.tag;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : null;
}

function isRunnerCallback(node: FunctionNode): boolean {
  const parent = node.parent;
  if (
    parent.type !== AST_NODE_TYPES.CallExpression ||
    !parent.arguments.some((argument) => argument === node)
  ) {
    return false;
  }
  const name = runnerName(parent.callee);
  return name !== null && RUNNERS.has(name);
}

/**
 * `expect(...)`, `assert(...)`, `assert.equal(...)`, or `t.expect(...)` /
 * `chai.assert(...)` on an identifier. Supertest's `request(app).expect(200)`
 * hangs off a call, not an identifier, and is not an assertion here.
 */
function isAssertionCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'expect' || callee.name === 'assert';
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.object.type !== AST_NODE_TYPES.Identifier ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  return (
    callee.object.name === 'assert' ||
    callee.property.name === 'expect' ||
    callee.property.name === 'assert'
  );
}

/** `fail(...)`, `t.fail(...)`, `expect.fail(...)`: an explicit test failure. */
function isFailCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'fail';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'fail'
  );
}

/** True when `chain` is `expect(...)` followed by `.rejects` or `.resolves` somewhere. */
function isAsyncExpectChain(chain: TSESTree.Expression): boolean {
  let async = false;
  let current: TSESTree.Node = chain;
  for (;;) {
    if (current.type === AST_NODE_TYPES.CallExpression) {
      if (isAssertionCall(current) && current.callee.type === AST_NODE_TYPES.Identifier) {
        return async;
      }
      current = current.callee;
    } else if (current.type === AST_NODE_TYPES.MemberExpression) {
      if (
        !current.computed &&
        current.property.type === AST_NODE_TYPES.Identifier &&
        ASYNC_MODIFIERS.has(current.property.name)
      ) {
        async = true;
      }
      current = current.object;
    } else {
      return false;
    }
  }
}

/** Wrappers an error passes through on its way into a log line: `e.message`, `` `${e}` ``. */
const LOG_OPERAND_TYPES = new Set<AST_NODE_TYPES>([
  AST_NODE_TYPES.MemberExpression,
  AST_NODE_TYPES.ChainExpression,
  AST_NODE_TYPES.TemplateLiteral,
  AST_NODE_TYPES.BinaryExpression,
  AST_NODE_TYPES.TSAsExpression,
  AST_NODE_TYPES.TSNonNullExpression,
]);

/** True when `identifier` only feeds an argument of a `console.*(...)` call. */
function isOnlyLogged(identifier: TSESTree.Node): boolean {
  let current = identifier;
  // `Program.parent` is typed `undefined` but is `null` at runtime.
  while (current.parent != null && LOG_OPERAND_TYPES.has(current.parent.type)) {
    const parent = current.parent;
    if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object !== current) {
      return false;
    }
    current = parent;
  }
  const call = current.parent;
  return (
    call?.type === AST_NODE_TYPES.CallExpression &&
    call.arguments.some((argument) => argument === current) &&
    call.callee.type === AST_NODE_TYPES.MemberExpression &&
    call.callee.object.type === AST_NODE_TYPES.Identifier &&
    call.callee.object.name === 'console'
  );
}

export const noSwallowedAssertionRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow assertions inside a `try` whose `catch` neither rethrows nor asserts, and `.catch()` handlers that swallow an `expect(...).rejects`/`.resolves` failure: the assertion fails, the error is dropped, and the test passes.',
    },
    schema: [],
    messages: {
      swallowedInCatch:
        'This `catch` swallows the failure of the assertion in its `try`, so the test passes when the assertion fails. Rethrow, assert on the error, or drop the `try`.',
      swallowedInPromiseCatch:
        'This `.catch()` swallows the failure of the `expect(...)` it is chained on, so the test passes when the assertion fails. Remove the `.catch()`.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;
    const candidates = new Map<TSESTree.TryStatement, SwallowingTry>();
    const promiseHandlers: { call: TSESTree.CallExpression; handler: FunctionNode }[] = [];
    /** Catch clauses and functions that contain a `throw`, an assertion or a `fail()`. */
    const handling = new Set<TSESTree.Node>();
    /** Every `throw`, assertion and `fail()`, for the retry-loop exemption. */
    const guards: TSESTree.Node[] = [];

    function markHandling(node: TSESTree.Node): void {
      guards.push(node);
      // `Program.parent` is typed `undefined` but is `null` at runtime.
      let current: TSESTree.Node | null | undefined = node.parent;
      while (current !== undefined && current !== null) {
        if (current.type === AST_NODE_TYPES.CatchClause || isFunctionNode(current)) {
          handling.add(current);
        }
        current = current.parent;
      }
    }

    /**
     * The nearest `try` whose protected block holds `node`, when that `try`
     * has a `catch` and runs inside a test or hook callback.
     */
    function enclosingTry(node: TSESTree.Node): SwallowingTry | null {
      let found: TSESTree.TryStatement | null = null;
      let child: TSESTree.Node = node;
      let current: TSESTree.Node | null | undefined = node.parent;
      while (current !== undefined && current !== null) {
        if (isFunctionNode(current) && isRunnerCallback(current)) {
          return found === null || found.handler === null
            ? null
            : { node: found, handler: found.handler, boundary: current };
        }
        // A `try/finally` does not swallow; an outer `try` still could, so keep going.
        if (
          found === null &&
          current.type === AST_NODE_TYPES.TryStatement &&
          current.block === child &&
          current.handler !== null
        ) {
          found = current;
        }
        child = current;
        current = current.parent;
      }
      return null;
    }

    /** True when the caught error is used for anything but logging (`lastError = e`, `handle(e)`). */
    function usesCaughtError(node: TSESTree.CatchClause | FunctionNode): boolean {
      return sourceCode.getDeclaredVariables(node).some((variable) =>
        variable.references.some((reference) => !isOnlyLogged(reference.identifier)),
      );
    }

    /**
     * A retry loop that falls through to a `throw` or an assertion after the
     * loop fails the test on its own, so the per-attempt `catch` may swallow.
     */
    function isGuardedRetry(entry: SwallowingTry): boolean {
      let current: TSESTree.Node | undefined = entry.node.parent;
      while (current !== undefined && current !== entry.boundary) {
        if (LOOP_TYPES.has(current.type)) {
          const loopEnd = current.range[1];
          const boundaryEnd = entry.boundary.range[1];
          return guards.some((guard) => guard.range[0] >= loopEnd && guard.range[1] <= boundaryEnd);
        }
        current = current.parent;
      }
      return false;
    }

    return {
      ThrowStatement(node: TSESTree.ThrowStatement): void {
        markHandling(node);
      },
      CallExpression(node: TSESTree.CallExpression): void {
        if (isFailCall(node)) {
          markHandling(node);
          return;
        }
        if (isAssertionCall(node)) {
          markHandling(node);
          const entry = enclosingTry(node);
          if (entry !== null && !candidates.has(entry.node)) {
            candidates.set(entry.node, entry);
          }
          return;
        }
        const callee = node.callee;
        const handler = node.arguments[0];
        if (
          callee.type === AST_NODE_TYPES.MemberExpression &&
          !callee.computed &&
          callee.property.type === AST_NODE_TYPES.Identifier &&
          callee.property.name === 'catch' &&
          handler !== undefined &&
          (handler.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            handler.type === AST_NODE_TYPES.FunctionExpression) &&
          isAsyncExpectChain(callee.object)
        ) {
          promiseHandlers.push({ call: node, handler });
        }
      },
      'Program:exit'(): void {
        for (const entry of candidates.values()) {
          if (
            handling.has(entry.handler) ||
            usesCaughtError(entry.handler) ||
            isGuardedRetry(entry)
          ) {
            continue;
          }
          context.report({ node: entry.handler, messageId: 'swallowedInCatch' });
        }
        for (const { call, handler } of promiseHandlers) {
          if (handling.has(handler) || usesCaughtError(handler)) {
            continue;
          }
          context.report({ node: call, messageId: 'swallowedInPromiseCatch' });
        }
      },
    };
  },
});
