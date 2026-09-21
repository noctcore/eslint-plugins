/*
 * Ported from tsforge (MIT), https://github.com/boringstack-xyz/tsforge
 * Source: packages/core/src/rule-packs/test-conventions/rules/fake-timers-must-be-restored.ts
 * at commit 75100ffd54fafc4874375e28f6865198dcb91839.
 * Copyright (c) 2026 Aleksandar Grbic. See THIRD_PARTY_NOTICES.md for the license text.
 */
import fs from 'node:fs';
import path from 'node:path';

import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesAny } from '../utils/allowMatch';

const RULE_NAME = 'fake-timers-must-be-restored';

export interface FakeTimersMustBeRestoredOptions {
  /** Method names that install fake timers (`jest.useFakeTimers`, `vi.useFakeTimers`). */
  readonly fakeTimerMethods?: readonly string[];
  /** Method names that restore real timers. Any one call anywhere in the file satisfies the rule. */
  readonly restoreTimerMethods?: readonly string[];
  /**
   * Follow relative imports whose binding this file calls (the shared-suite
   * shape: `runProviderContract(subject)`) and accept a restore call found in
   * that module's source.
   */
  readonly followImportedSuites?: boolean;
  /**
   * Globs matched against import specifiers. A file that imports and calls a
   * binding from a matching module is trusted to have its timers restored by
   * that module. Use for suites the rule cannot resolve on disk (path aliases,
   * workspace packages).
   */
  readonly sharedSuiteModules?: readonly string[];
}

type RuleOptions = [FakeTimersMustBeRestoredOptions];
type MessageIds = 'timersNotRestored';

const DEFAULT_FAKE_TIMER_METHODS: readonly string[] = ['useFakeTimers'];
const DEFAULT_RESTORE_TIMER_METHODS: readonly string[] = ['useRealTimers'];
const DEFAULT_FOLLOW_IMPORTED_SUITES = true;
const DEFAULT_SHARED_SUITE_MODULES: readonly string[] = [];

/** Extensions tried, in order, when resolving a relative import to a file. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const methodList: JSONSchema4 = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  uniqueItems: true,
  minItems: 1,
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fakeTimerMethods: methodList,
    restoreTimerMethods: methodList,
    followImportedSuites: { type: 'boolean' },
    sharedSuiteModules: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  },
};

/*
 * The restore for a shared test suite often lives in the suite module, not in
 * the spec that runs it: the spec installs fake timers inside a helper it hands
 * to `runXContract(subject)`, and the suite's own `afterEach` restores them.
 * A per-file check misfires on that shape, so the rule follows the relative
 * imports this file actually calls and reads their source for a restore call.
 * The read is one level deep and text-based (a restore named in a comment also
 * counts), and results are cached per file modification time.
 */
const sourceCache = new Map<string, { mtimeMs: number; text: string }>();

function readSource(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return null;
    }
    const cached = sourceCache.get(file);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) {
      return cached.text;
    }
    const text = fs.readFileSync(file, 'utf8');
    sourceCache.set(file, { mtimeMs: stat.mtimeMs, text });
    return text;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return null;
    }
    throw error;
  }
}

/** Resolve a relative specifier the way a bundler would: as-is, with an extension, or as a directory index. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  // `./suite.js` written for NodeNext resolution usually points at `./suite.ts`.
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/u, '');
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => stem + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (readSource(candidate) !== null) {
      return candidate;
    }
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** True when some binding this import declares is called somewhere in the file. */
function importIsCalled(
  sourceCode: TSESLint.SourceCode,
  declaration: TSESTree.ImportDeclaration,
): boolean {
  return sourceCode.getDeclaredVariables(declaration).some((variable) =>
    variable.references.some((reference) => {
      const parent = reference.identifier.parent;
      if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === reference.identifier) {
        return true;
      }
      // `suite.run(subject)` on a namespace or default import.
      return (
        parent.type === AST_NODE_TYPES.MemberExpression &&
        parent.object === reference.identifier &&
        parent.parent.type === AST_NODE_TYPES.CallExpression &&
        parent.parent.callee === parent
      );
    }),
  );
}

/** The called method name for `name()` or a non-computed `obj.name()`, else null. */
function calledMethodName(node: TSESTree.CallExpression): string | null {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
}

export const fakeTimersMustBeRestoredRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A test file that calls `useFakeTimers()` must also call `useRealTimers()`, so fake timers do not leak into later tests.',
    },
    schema: [optionSchema],
    messages: {
      timersNotRestored:
        '`{{method}}()` is called without a matching restore call, so fake timers leak into other tests. Call `useRealTimers()` in an `afterEach`, here or in the shared suite this file runs.',
    },
  },
  defaultOptions: [
    {
      fakeTimerMethods: [...DEFAULT_FAKE_TIMER_METHODS],
      restoreTimerMethods: [...DEFAULT_RESTORE_TIMER_METHODS],
      followImportedSuites: DEFAULT_FOLLOW_IMPORTED_SUITES,
      sharedSuiteModules: [...DEFAULT_SHARED_SUITE_MODULES],
    },
  ],
  create(context, [options]) {
    const fakeMethods = new Set(options.fakeTimerMethods ?? DEFAULT_FAKE_TIMER_METHODS);
    const restoreMethodList = options.restoreTimerMethods ?? DEFAULT_RESTORE_TIMER_METHODS;
    const restoreMethods = new Set(restoreMethodList);
    const followImportedSuites = options.followImportedSuites ?? DEFAULT_FOLLOW_IMPORTED_SUITES;
    const sharedSuiteModules = options.sharedSuiteModules ?? DEFAULT_SHARED_SUITE_MODULES;
    const restoreCallPattern = new RegExp(
      `\\b(?:${restoreMethodList.map(escapeRegExp).join('|')})\\s*\\(`,
      'u',
    );
    const fakeCalls: { node: TSESTree.CallExpression; method: string }[] = [];
    const imports: TSESTree.ImportDeclaration[] = [];
    let hasRestore = false;

    /** True when a called import is a declared shared suite, or its source restores timers. */
    function restoredByImportedSuite(): boolean {
      return imports.some((declaration) => {
        const specifier = declaration.source.value;
        if (!importIsCalled(context.sourceCode, declaration)) {
          return false;
        }
        if (matchesAny(specifier, sharedSuiteModules)) {
          return true;
        }
        if (!followImportedSuites || !specifier.startsWith('.')) {
          return false;
        }
        const resolved = resolveRelative(context.filename, specifier);
        const text = resolved === null ? null : readSource(resolved);
        return text !== null && restoreCallPattern.test(text);
      });
    }

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        if (node.importKind !== 'type') {
          imports.push(node);
        }
      },
      CallExpression(node: TSESTree.CallExpression): void {
        const method = calledMethodName(node);
        if (method === null) {
          return;
        }
        if (fakeMethods.has(method)) {
          fakeCalls.push({ node, method });
        }
        if (restoreMethods.has(method)) {
          hasRestore = true;
        }
      },
      'Program:exit'(): void {
        if (fakeCalls.length === 0 || hasRestore || restoredByImportedSuite()) {
          return;
        }
        for (const { node, method } of fakeCalls) {
          context.report({ node, messageId: 'timersNotRestored', data: { method } });
        }
      },
    };
  },
});
