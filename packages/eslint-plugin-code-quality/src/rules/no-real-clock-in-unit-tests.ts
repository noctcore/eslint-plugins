import path from 'node:path';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesAny } from '../utils/allowMatch';

const RULE_NAME = 'no-real-clock-in-unit-tests';

export interface NoRealClockInUnitTestsOptions {
  /** A file is a unit test when its path ends with one of these. */
  readonly testFileSuffixes?: readonly string[];
  /** A test file whose project-relative path contains one of these is an integration test and is skipped. */
  readonly integrationMarkers?: readonly string[];
  /** Method names that fake the clock for the file (`vi.useFakeTimers()`, `vi.setSystemTime(...)`). */
  readonly fakeClockMethods?: readonly string[];
  /**
   * Globs matched against module specifiers. A file that mocks a matching
   * module (`vi.mock('../common/clock')`) controls its clock through that seam.
   */
  readonly clockModules?: readonly string[];
}

type RuleOptions = [NoRealClockInUnitTestsOptions];
type MessageIds = 'realClockInUnitTest';

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

const DEFAULT_FAKE_CLOCK_METHODS: readonly string[] = ['useFakeTimers', 'setSystemTime'];
const DEFAULT_CLOCK_MODULES: readonly string[] = [];

/** Test-double APIs that replace a module for the whole file. */
const MODULE_MOCKERS = new Set(['mock', 'doMock', 'unstable_mockModule']);
/** Receivers whose `Date` a spy can replace: `vi.spyOn(globalThis, 'Date')`. */
const GLOBAL_RECEIVERS = new Set(['globalThis', 'window', 'self', 'global']);
/** Methods that turn a `new Date()` into a number, so it can be an offset operand. */
const DATE_TO_NUMBER = new Set(['getTime', 'valueOf']);

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
    fakeClockMethods: { ...stringList, minItems: 1 },
    clockModules: stringList,
  },
};

function toPosixRelative(filename: string, cwd: string): string {
  const relative = path.isAbsolute(filename) ? path.relative(cwd, filename) : filename;
  return `/${relative.split(path.sep).join('/')}`;
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

function stringArgument(node: TSESTree.CallExpression, index: number): string | null {
  const argument = node.arguments[index];
  return argument?.type === AST_NODE_TYPES.Literal && typeof argument.value === 'string'
    ? argument.value
    : null;
}

function isIdentifier(node: TSESTree.Node, name: string): boolean {
  return node.type === AST_NODE_TYPES.Identifier && node.name === name;
}

/** The called method name for `name()` or `obj.name()`, else null. */
function calledMethodName(node: TSESTree.CallExpression): string | null {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  return callee.type === AST_NODE_TYPES.MemberExpression ? staticPropertyName(callee) : null;
}

/** True for `Date.now()`. */
function isDateNow(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    isIdentifier(callee.object, 'Date') &&
    staticPropertyName(callee) === 'now'
  );
}

/** True when `node` is a direct operand of `+` or `-`: an offset from now. */
function isOffsetOperand(node: TSESTree.Node): boolean {
  const parent = node.parent;
  return (
    parent?.type === AST_NODE_TYPES.BinaryExpression &&
    (parent.operator === '+' || parent.operator === '-')
  );
}

/** True when an argless `new Date()` is only turned into a number that is offset: `new Date().getTime() + 1000`. */
function isOffsetDate(node: TSESTree.NewExpression): boolean {
  const member = node.parent;
  if (member?.type === AST_NODE_TYPES.UnaryExpression && member.operator === '+') {
    return isOffsetOperand(member);
  }
  if (member?.type !== AST_NODE_TYPES.MemberExpression || member.object !== node) {
    return false;
  }
  const name = staticPropertyName(member);
  const call = member.parent;
  return (
    name !== null &&
    DATE_TO_NUMBER.has(name) &&
    call.type === AST_NODE_TYPES.CallExpression &&
    call.callee === member &&
    isOffsetOperand(call)
  );
}

export const noRealClockInUnitTestsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Unit tests must not read the real clock (`Date.now()`, `new Date()`) unless the file fakes it; an offset from now (`Date.now() + 60_000`) is allowed.',
    },
    schema: [optionSchema],
    messages: {
      realClockInUnitTest:
        '`{{call}}` reads the real clock in a unit test that never fakes it, so the value changes on every run (midnight, month end, DST). Fake the clock (`useFakeTimers()` plus `setSystemTime(...)`), mock the clock module, or use a fixed date. An offset from now (`Date.now() + 60_000`) is allowed.',
    },
  },
  defaultOptions: [
    {
      testFileSuffixes: [...DEFAULT_TEST_FILE_SUFFIXES],
      integrationMarkers: [...DEFAULT_INTEGRATION_MARKERS],
      fakeClockMethods: [...DEFAULT_FAKE_CLOCK_METHODS],
      clockModules: [...DEFAULT_CLOCK_MODULES],
    },
  ],
  create(context, [options]) {
    const testSuffixes = options.testFileSuffixes ?? DEFAULT_TEST_FILE_SUFFIXES;
    const integrationMarkers = options.integrationMarkers ?? DEFAULT_INTEGRATION_MARKERS;
    const fakeClockMethods = new Set(options.fakeClockMethods ?? DEFAULT_FAKE_CLOCK_METHODS);
    const clockModules = options.clockModules ?? DEFAULT_CLOCK_MODULES;
    const relPath = toPosixRelative(context.filename, context.cwd);

    if (!testSuffixes.some((suffix) => relPath.endsWith(suffix))) {
      return {};
    }
    if (integrationMarkers.some((marker) => relPath.includes(marker))) {
      return {};
    }

    const findings: { node: TSESTree.Node; call: string }[] = [];
    let faked = false;

    /** True when `node` fakes the clock: fake timers, a `Date` spy, or a mocked clock module. */
    function fakesClock(node: TSESTree.CallExpression): boolean {
      const method = calledMethodName(node);
      if (method === null) {
        return false;
      }
      if (fakeClockMethods.has(method)) {
        return true;
      }
      if (method === 'spyOn' || method === 'replaceProperty') {
        const target = node.arguments[0];
        const property = stringArgument(node, 1);
        if (target === undefined || property === null) {
          return false;
        }
        const spiesDateNow = isIdentifier(target, 'Date') && property === 'now';
        const replacesDate =
          target.type === AST_NODE_TYPES.Identifier &&
          GLOBAL_RECEIVERS.has(target.name) &&
          property === 'Date';
        return spiesDateNow || replacesDate;
      }
      if (MODULE_MOCKERS.has(method) && node.callee.type === AST_NODE_TYPES.MemberExpression) {
        const specifier = stringArgument(node, 0);
        return specifier !== null && matchesAny(specifier, clockModules);
      }
      return false;
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (fakesClock(node)) {
          faked = true;
          return;
        }
        if (isDateNow(node) && !isOffsetOperand(node)) {
          findings.push({ node, call: 'Date.now()' });
        } else if (isIdentifier(node.callee, 'Date') && node.arguments.length === 0) {
          findings.push({ node, call: 'Date()' });
        }
      },
      NewExpression(node: TSESTree.NewExpression): void {
        if (isIdentifier(node.callee, 'Date') && node.arguments.length === 0 && !isOffsetDate(node)) {
          findings.push({ node, call: 'new Date()' });
        }
      },
      AssignmentExpression(node: TSESTree.AssignmentExpression): void {
        // `Date.now = () => 0` swaps the clock for the file.
        const target = node.left;
        if (
          target.type === AST_NODE_TYPES.MemberExpression &&
          isIdentifier(target.object, 'Date') &&
          staticPropertyName(target) === 'now'
        ) {
          faked = true;
        }
      },
      'Program:exit'(): void {
        if (faked) {
          return;
        }
        for (const { node, call } of findings) {
          context.report({ node, messageId: 'realClockInUnitTest', data: { call } });
        }
      },
    };
  },
});
