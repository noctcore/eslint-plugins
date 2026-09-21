/*
 * Ported from tsforge (MIT), https://github.com/boringstack-xyz/tsforge
 * Source: packages/core/src/rule-packs/test-conventions/rules/no-real-network-in-unit-tests.ts
 * at commit 75100ffd54fafc4874375e28f6865198dcb91839.
 * Copyright (c) 2026 Aleksandar Grbic. See THIRD_PARTY_NOTICES.md for the license text.
 */
import path from 'node:path';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-real-network-in-unit-tests';

export interface NoRealNetworkInUnitTestsOptions {
  /** A file is a unit test when its path ends with one of these. */
  readonly testFileSuffixes?: readonly string[];
  /** A test file whose project-relative path contains one of these is an integration test and is skipped. */
  readonly integrationMarkers?: readonly string[];
  /** Global functions that perform network I/O when called (`fetch`, `globalThis.fetch`). */
  readonly networkCallees?: readonly string[];
  /** Default-imported or global HTTP clients whose request methods, and direct calls, perform network I/O. */
  readonly httpClients?: readonly string[];
}

type RuleOptions = [NoRealNetworkInUnitTestsOptions];
type MessageIds = 'realNetworkInUnitTest';

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

const DEFAULT_NETWORK_CALLEES: readonly string[] = ['fetch'];
const DEFAULT_HTTP_CLIENTS: readonly string[] = ['axios'];

const HTTP_CLIENT_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'request',
]);

/** Receivers through which a global function can be called: `globalThis.fetch(...)`. */
const GLOBAL_RECEIVERS = new Set(['globalThis', 'window', 'self', 'global']);

/** Test-double APIs that replace a module or a global for the whole file. */
const MODULE_MOCKERS = new Set(['mock', 'doMock', 'unstable_mockModule']);
const GLOBAL_STUBBERS = new Set(['stubGlobal', 'spyOn', 'replaceProperty']);

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
    networkCallees: stringList,
    httpClients: stringList,
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

export const noRealNetworkInUnitTestsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Unit tests must not perform real network I/O: mock the HTTP client, or move the test to an integration suite.',
    },
    schema: [optionSchema],
    messages: {
      realNetworkInUnitTest:
        'Real network call `{{callee}}` in a unit test. Mock it, or move this test to an integration file.',
    },
  },
  defaultOptions: [
    {
      testFileSuffixes: [...DEFAULT_TEST_FILE_SUFFIXES],
      integrationMarkers: [...DEFAULT_INTEGRATION_MARKERS],
      networkCallees: [...DEFAULT_NETWORK_CALLEES],
      httpClients: [...DEFAULT_HTTP_CLIENTS],
    },
  ],
  create(context, [options]) {
    const testSuffixes = options.testFileSuffixes ?? DEFAULT_TEST_FILE_SUFFIXES;
    const integrationMarkers = options.integrationMarkers ?? DEFAULT_INTEGRATION_MARKERS;
    const networkCallees = new Set(options.networkCallees ?? DEFAULT_NETWORK_CALLEES);
    const httpClients = new Set(options.httpClients ?? DEFAULT_HTTP_CLIENTS);
    const relPath = toPosixRelative(context.filename, context.cwd);

    if (!testSuffixes.some((suffix) => relPath.endsWith(suffix))) {
      return {};
    }
    if (integrationMarkers.some((marker) => relPath.includes(marker))) {
      return {};
    }

    const findings: { node: TSESTree.CallExpression; callee: string }[] = [];
    /** Callee names the file replaces with a test double (`vi.mock('axios')`, `vi.stubGlobal('fetch', ...)`). */
    const mocked = new Set<string>();
    /** Local import binding to its module, so `vi.mock('node-fetch')` covers `import fetch from 'node-fetch'`. */
    const importSources = new Map<string, string>();

    /**
     * True when `name` resolves to a local declaration (not an import, not a
     * global) where `node` references it. A local `const fetch = vi.fn()` is a
     * test double; an imported `fetch` from `node-fetch` is still the network.
     */
    function isLocalDouble(node: TSESTree.Node, name: string): boolean {
      let scope: ReturnType<typeof context.sourceCode.getScope> | null =
        context.sourceCode.getScope(node);
      while (scope !== null) {
        const variable = scope.set.get(name);
        if (variable !== undefined && variable.defs.length > 0) {
          return variable.defs.every((def) => def.type !== 'ImportBinding');
        }
        scope = scope.upper;
      }
      return false;
    }

    function recordMock(node: TSESTree.CallExpression): void {
      const callee = node.callee;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return;
      }
      const method = staticPropertyName(callee);
      if (method !== null && MODULE_MOCKERS.has(method)) {
        const moduleName = stringArgument(node, 0);
        if (moduleName !== null) {
          mocked.add(moduleName);
        }
      }
      if (method !== null && GLOBAL_STUBBERS.has(method)) {
        // `vi.stubGlobal('fetch', ...)` names the global first; `spyOn(globalThis, 'fetch')` second.
        const name = method === 'stubGlobal' ? stringArgument(node, 0) : stringArgument(node, 1);
        if (name !== null) {
          mocked.add(name);
        }
      }
    }

    /** The reported callee label for a real network call, or null. */
    function networkCallee(node: TSESTree.CallExpression): string | null {
      const callee = node.callee;
      if (callee.type === AST_NODE_TYPES.Identifier) {
        const isNetworkName = networkCallees.has(callee.name) || httpClients.has(callee.name);
        return isNetworkName && !isLocalDouble(callee, callee.name) ? callee.name : null;
      }
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return null;
      }
      const method = staticPropertyName(callee);
      if (method === null || callee.object.type !== AST_NODE_TYPES.Identifier) {
        return null;
      }
      const receiver = callee.object.name;
      if (GLOBAL_RECEIVERS.has(receiver) && networkCallees.has(method)) {
        return method;
      }
      if (
        httpClients.has(receiver) &&
        HTTP_CLIENT_METHODS.has(method) &&
        !isLocalDouble(callee.object, receiver)
      ) {
        return `${receiver}.${method}`;
      }
      return null;
    }

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        for (const specifier of node.specifiers) {
          importSources.set(specifier.local.name, node.source.value);
        }
      },
      CallExpression(node: TSESTree.CallExpression): void {
        recordMock(node);
        const callee = networkCallee(node);
        if (callee !== null) {
          findings.push({ node, callee });
        }
      },
      AssignmentExpression(node: TSESTree.AssignmentExpression): void {
        // `globalThis.fetch = vi.fn()` swaps the global for a double.
        const target = node.left;
        if (
          target.type === AST_NODE_TYPES.MemberExpression &&
          target.object.type === AST_NODE_TYPES.Identifier &&
          GLOBAL_RECEIVERS.has(target.object.name)
        ) {
          const name = staticPropertyName(target);
          if (name !== null) {
            mocked.add(name);
          }
        }
      },
      'Program:exit'(): void {
        for (const { node, callee } of findings) {
          const root = callee.split('.')[0] ?? callee;
          const source = importSources.get(root);
          if (mocked.has(root) || (source !== undefined && mocked.has(source))) {
            continue;
          }
          context.report({ node, messageId: 'realNetworkInUnitTest', data: { callee } });
        }
      },
    };
  },
});
