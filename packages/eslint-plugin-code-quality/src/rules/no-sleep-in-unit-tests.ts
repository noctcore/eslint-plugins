import path from 'node:path';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { type VisitorKeys, walkSome } from '../utils/ast';

const RULE_NAME = 'no-sleep-in-unit-tests';

export interface NoSleepInUnitTestsOptions {
  /** A file is a unit test when its path ends with one of these. */
  readonly testFileSuffixes?: readonly string[];
  /** A test file whose project-relative path contains one of these is an integration test and is skipped. */
  readonly integrationMarkers?: readonly string[];
  /**
   * Accept a zero or omitted delay (`setTimeout(resolve, 0)`): it yields one
   * macrotask, which is the idiomatic flush inside `act(...)`, not a wait on
   * the clock.
   */
  readonly allowZeroDelay?: boolean;
  /**
   * Method names that install fake timers (`vi.useFakeTimers()`,
   * `jest.useFakeTimers()`). A file that calls one anywhere drives its timers
   * virtually, so its timer promises cost no wall-clock time.
   */
  readonly fakeTimerMethods?: readonly string[];
}

type RuleOptions = [NoSleepInUnitTestsOptions];
type MessageIds = 'sleepInUnitTest';

const DEFAULT_TEST_FILE_SUFFIXES: readonly string[] = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.js',
  '.test.jsx',
  '.spec.js',
  '.spec.jsx',
];

const DEFAULT_INTEGRATION_MARKERS: readonly string[] = [
  '.integration.test.',
  '.integration.spec.',
  '.e2e.test.',
  '.e2e.spec.',
  '.e2e-spec.',
  '/integration/',
  '/e2e/',
];

const DEFAULT_ALLOW_ZERO_DELAY = true;
const DEFAULT_FAKE_TIMER_METHODS: readonly string[] = ['useFakeTimers'];

const TIMERS_PROMISES_MODULES = new Set(['timers/promises', 'node:timers/promises']);
/** Exports of `timers/promises` that wait for a delay given as the first argument. */
const TIMERS_PROMISES_SLEEPS = new Set(['setTimeout']);
const TIMER_RECEIVERS = new Set(['globalThis', 'window', 'self', 'global']);
const CLEAR_TIMERS = new Set(['clearTimeout', 'clearInterval']);

const stringList: JSONSchema4 = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  uniqueItems: true,
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    testFileSuffixes: stringList,
    integrationMarkers: stringList,
    allowZeroDelay: { type: 'boolean' },
    fakeTimerMethods: { ...stringList, minItems: 1 },
  },
};

type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

function toPosixRelative(filename: string, cwd: string): string {
  const relative = path.isAbsolute(filename) ? path.relative(cwd, filename) : filename;
  return `/${relative.split(path.sep).join('/')}`;
}

function isFunction(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression
  );
}

function staticPropertyName(member: TSESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === AST_NODE_TYPES.Identifier) {
    return member.property.name;
  }
  if (member.property.type === AST_NODE_TYPES.Literal && typeof member.property.value === 'string') {
    return member.property.value;
  }
  return null;
}

/** True for `setTimeout` and `globalThis.setTimeout` (and the other global receivers). */
function isGlobalSetTimeout(callee: TSESTree.Node): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'setTimeout';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    TIMER_RECEIVERS.has(callee.object.name) &&
    staticPropertyName(callee) === 'setTimeout'
  );
}

/** The nearest enclosing function of `node`, or null at the top level. */
function enclosingFunction(node: TSESTree.Node): TSESTree.Node | null {
  // `parent` is null on the Program node at runtime, whatever the types say.
  for (let current = node.parent; current != null; current = current.parent) {
    if (isFunction(current) || current.type === AST_NODE_TYPES.FunctionDeclaration) {
      return current;
    }
  }
  return null;
}

/** The executor's `resolve` parameter name when `fn` is `new Promise(fn)`'s executor. */
function promiseResolveName(fn: TSESTree.Node | null): string | null {
  if (fn === null || !isFunction(fn)) {
    return null;
  }
  const parent = fn.parent;
  if (
    parent.type !== AST_NODE_TYPES.NewExpression ||
    parent.callee.type !== AST_NODE_TYPES.Identifier ||
    parent.callee.name !== 'Promise' ||
    parent.arguments[0] !== fn
  ) {
    return null;
  }
  const resolve = fn.params[0];
  return resolve?.type === AST_NODE_TYPES.Identifier ? resolve.name : null;
}

/** True when the timer callback settles the promise by resolving it (not a reject-only timeout guard). */
function resolvesPromise(
  callback: TSESTree.Node | undefined,
  resolveName: string,
  keys: VisitorKeys,
): boolean {
  if (callback === undefined) {
    return false;
  }
  if (callback.type === AST_NODE_TYPES.Identifier) {
    return callback.name === resolveName;
  }
  return (
    isFunction(callback) &&
    walkSome(
      callback.body,
      keys,
      (node) =>
        node.type === AST_NODE_TYPES.CallExpression &&
        node.callee.type === AST_NODE_TYPES.Identifier &&
        node.callee.name === resolveName,
    )
  );
}

/**
 * The node the timer's handle is kept in (`timer = setTimeout(...)`,
 * `const t = setTimeout(...)`), or null. A kept handle that the file later
 * passes to `clearTimeout` is a deadline raced against real work, not a sleep.
 */
function handleTarget(node: TSESTree.CallExpression): TSESTree.Node | null {
  const parent = node.parent;
  if (parent.type === AST_NODE_TYPES.AssignmentExpression && parent.right === node) {
    return parent.left;
  }
  if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === node) {
    return parent.id;
  }
  return null;
}

/** True for `clearTimeout` / `clearInterval`, also on a global receiver. */
function isClearTimer(callee: TSESTree.Node): boolean {
  const name =
    callee.type === AST_NODE_TYPES.Identifier
      ? callee.name
      : callee.type === AST_NODE_TYPES.MemberExpression &&
          callee.object.type === AST_NODE_TYPES.Identifier &&
          TIMER_RECEIVERS.has(callee.object.name)
        ? staticPropertyName(callee)
        : null;
  return name !== null && CLEAR_TIMERS.has(name);
}

/** True for an omitted delay or a literal `0`. */
function isZeroDelay(delay: TSESTree.Node | undefined): boolean {
  return delay === undefined || (delay.type === AST_NODE_TYPES.Literal && delay.value === 0);
}

/** True when `init` is `promisify(setTimeout)` or `util.promisify(setTimeout)`. */
function isPromisifiedSetTimeout(init: TSESTree.Expression | null): boolean {
  if (init?.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const callee = init.callee;
  const name =
    callee.type === AST_NODE_TYPES.Identifier
      ? callee.name
      : callee.type === AST_NODE_TYPES.MemberExpression
        ? staticPropertyName(callee)
        : null;
  const target = init.arguments[0];
  return name === 'promisify' && target !== undefined && isGlobalSetTimeout(target);
}

export const noSleepInUnitTestsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Unit tests must not sleep on the real clock (`new Promise((r) => setTimeout(r, n))`, `timers/promises`): fake the timers or wait for the condition.',
    },
    schema: [optionSchema],
    messages: {
      sleepInUnitTest:
        'This unit test sleeps on the real clock (delay `{{delay}}`), so it is slow and flaky under load. Fake the timers and advance them, or wait for the condition itself (`waitFor`, `findBy*`, the promise under test).',
    },
  },
  defaultOptions: [
    {
      testFileSuffixes: [...DEFAULT_TEST_FILE_SUFFIXES],
      integrationMarkers: [...DEFAULT_INTEGRATION_MARKERS],
      allowZeroDelay: DEFAULT_ALLOW_ZERO_DELAY,
      fakeTimerMethods: [...DEFAULT_FAKE_TIMER_METHODS],
    },
  ],
  create(context, [options]) {
    const testSuffixes = options.testFileSuffixes ?? DEFAULT_TEST_FILE_SUFFIXES;
    const integrationMarkers = options.integrationMarkers ?? DEFAULT_INTEGRATION_MARKERS;
    const allowZeroDelay = options.allowZeroDelay ?? DEFAULT_ALLOW_ZERO_DELAY;
    const fakeTimerMethods = new Set(options.fakeTimerMethods ?? DEFAULT_FAKE_TIMER_METHODS);
    const relPath = toPosixRelative(context.filename, context.cwd);

    if (!testSuffixes.some((suffix) => relPath.endsWith(suffix))) {
      return {};
    }
    if (integrationMarkers.some((marker) => relPath.includes(marker))) {
      return {};
    }

    /** Local names that sleep for their first argument: `timers/promises` imports and promisified timers. */
    const sleepFunctions = new Set<string>();
    /** Namespace imports of `timers/promises`: `timers.setTimeout(ms)`. */
    const timerNamespaces = new Set<string>();
    /** Each sleep found, with the source text of the handle it is kept in, if any. */
    const findings: { node: TSESTree.Node; delay: string; handle: string | null }[] = [];
    /** Source text of every handle passed to `clearTimeout` / `clearInterval` in the file. */
    const clearedHandles = new Set<string>();
    let fakesTimers = false;

    function record(
      node: TSESTree.Node,
      delay: TSESTree.Node | undefined,
      handle: TSESTree.Node | null = null,
    ): void {
      if (allowZeroDelay && isZeroDelay(delay)) {
        return;
      }
      const text = delay === undefined ? '0' : context.sourceCode.getText(delay);
      const handleText = handle === null ? null : context.sourceCode.getText(handle);
      findings.push({ node, delay: text, handle: handleText });
    }

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        if (!TIMERS_PROMISES_MODULES.has(node.source.value)) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            timerNamespaces.add(specifier.local.name);
          } else if (
            specifier.type === AST_NODE_TYPES.ImportSpecifier &&
            specifier.imported.type === AST_NODE_TYPES.Identifier &&
            TIMERS_PROMISES_SLEEPS.has(specifier.imported.name)
          ) {
            sleepFunctions.add(specifier.local.name);
          }
        }
      },
      VariableDeclarator(node: TSESTree.VariableDeclarator): void {
        if (node.id.type === AST_NODE_TYPES.Identifier && isPromisifiedSetTimeout(node.init)) {
          sleepFunctions.add(node.id.name);
        }
      },
      CallExpression(node: TSESTree.CallExpression): void {
        const callee = node.callee;
        if (
          callee.type === AST_NODE_TYPES.MemberExpression &&
          fakeTimerMethods.has(staticPropertyName(callee) ?? '')
        ) {
          fakesTimers = true;
          return;
        }
        if (callee.type === AST_NODE_TYPES.Identifier && sleepFunctions.has(callee.name)) {
          record(node, node.arguments[0]);
          return;
        }
        if (
          callee.type === AST_NODE_TYPES.MemberExpression &&
          callee.object.type === AST_NODE_TYPES.Identifier &&
          timerNamespaces.has(callee.object.name)
        ) {
          const method = staticPropertyName(callee);
          if (method !== null && TIMERS_PROMISES_SLEEPS.has(method)) {
            record(node, node.arguments[0]);
          }
          return;
        }
        if (isClearTimer(callee)) {
          const handle = node.arguments[0];
          if (handle !== undefined) {
            clearedHandles.add(context.sourceCode.getText(handle));
          }
          return;
        }
        if (!isGlobalSetTimeout(callee)) {
          return;
        }
        const resolveName = promiseResolveName(enclosingFunction(node));
        const keys = context.sourceCode.visitorKeys;
        if (resolveName !== null && resolvesPromise(node.arguments[0], resolveName, keys)) {
          record(node, node.arguments[1], handleTarget(node));
        }
      },
      'Program:exit'(): void {
        if (fakesTimers) {
          return;
        }
        for (const { node, delay, handle } of findings) {
          if (handle !== null && clearedHandles.has(handle)) {
            continue;
          }
          context.report({ node, messageId: 'sleepInUnitTest', data: { delay } });
        }
      },
    };
  },
});
