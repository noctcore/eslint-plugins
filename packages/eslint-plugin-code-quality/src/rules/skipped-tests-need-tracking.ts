import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { runnerName } from '../utils/ast';

const RULE_NAME = 'skipped-tests-need-tracking';

export interface SkippedTestsNeedTrackingOptions {
  /** Regex sources (compiled with the `u` flag) any of which satisfies the
   * tracking requirement. The default accepts a URL or `TODO(@owner)`. */
  readonly markers?: readonly string[];
  /** How many lines above the skip a tracking marker may live to count. */
  readonly lookback?: number;
}

type RuleOptions = [SkippedTestsNeedTrackingOptions];
type MessageIds = 'needsTracking';

/*
 * `.skip` / `.fixme` / `xit` / `xdescribe` are escape hatches that rot into
 * permanent dark zones if left unowned. Each must carry a tracking marker (an
 * issue URL or `TODO(@owner)`) within the lookback window so the debt has a
 * human attached. `.only` is NOT listed here: `no-focused-tests` bans it
 * outright, so it can never legitimately appear with or without tracking.
 *
 * A skip is found in the AST, as a call, so the same text inside a string, a
 * template literal or a comment is not one. Only the tracking marker is looked
 * up in the source text: the lines of the lookback window are scanned as
 * written, so a marker in a trailing or preceding comment (or anywhere in the
 * window) is honoured exactly as a human reviewer would read it.
 *
 * `node:test` skips a test through its options (`test('x', { skip: true })`,
 * `{ todo: 'reason' }`) or its context (`t.skip()`, `t.todo()`). Only an
 * UNCONDITIONAL skip is debt there: `{ skip: process.platform === 'win32' }` or
 * a `t.skip('POSIX only')` inside an `if` is a platform guard, not a test
 * someone meant to come back to. The marker is looked up the same way, from the
 * line of the option or the call.
 */
/** Runners that skip through a modifier: `it.skip(`, `test.describe.fixme(`. */
const SKIPPABLE_RUNNERS = new Set(['it', 'test', 'describe']);
/** Modifiers that skip the runner they are called on. */
const SKIP_MODIFIERS = new Set(['skip', 'fixme']);
/** Runner aliases that skip by name. */
const SKIPPED_RUNNERS = new Set(['xit', 'xdescribe', 'xtest']);

/** Runners whose options object may carry `skip` / `todo` (`node:test`, and `t.test` subtests). */
const NODE_TEST_RUNNERS = new Set(['test', 'it', 'describe', 'suite']);
/** Option keys and context methods that skip a `node:test` test. */
const NODE_TEST_SKIPS = new Set(['skip', 'todo']);

const DEFAULT_MARKERS: readonly string[] = ['https?://\\S+', 'TODO\\(@?\\S+\\)'];
const DEFAULT_LOOKBACK = 30;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markers: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
    lookback: { type: 'integer', minimum: 0 },
  },
};

/** Last name of a callee: `xit` for `xit`, `skip` for `it.skip`, else null. */
function calleeName(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
    ? callee.property.name
    : null;
}

/** The label of a skipping runner call (`it.skip(...)`, `xit(...)`), else null. */
function skipLabel(callee: TSESTree.Node): string | null {
  const name = calleeName(callee);
  if (name === null) {
    return null;
  }
  if (SKIPPED_RUNNERS.has(name)) {
    return `${name}(`;
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !SKIP_MODIFIERS.has(name)) {
    return null;
  }
  const runner = calleeName(callee.object);
  return runner !== null && SKIPPABLE_RUNNERS.has(runner) ? `.${name}(` : null;
}

/** True for a call to a test runner, including a subtest (`t.test(...)`). */
function isRunnerCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  const root = runnerName(callee);
  if (root !== null && NODE_TEST_RUNNERS.has(root)) {
    return true;
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    NODE_TEST_RUNNERS.has(callee.property.name)
  );
}

function propertyKey(property: TSESTree.Property): string | null {
  if (property.computed) {
    return null;
  }
  if (property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  return property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string'
    ? property.key.value
    : null;
}

/**
 * True when an option value always skips: any truthy literal (`true`, `1`, a
 * non-empty string). A computed value is a guard.
 */
function isUnconditionalSkip(value: TSESTree.Node): boolean {
  if (value.type === AST_NODE_TYPES.Literal) {
    return 'regex' in value || Boolean(value.value);
  }
  return (
    value.type === AST_NODE_TYPES.TemplateLiteral &&
    value.expressions.length === 0 &&
    value.quasis.some((quasi) => quasi.value.cooked !== '')
  );
}

/**
 * The context parameter name when `node` is a statement of a test callback's
 * own body (`async (t) => { t.skip(); ... }`), else null. A call nested in an
 * `if`, a loop or a helper is conditional.
 */
function unconditionalContextName(node: TSESTree.CallExpression): string | null {
  // `await t.skip()` is the same statement as `t.skip()`.
  const statement = node.parent.type === AST_NODE_TYPES.AwaitExpression ? node.parent.parent : node.parent;
  const body = statement.type === AST_NODE_TYPES.ExpressionStatement ? statement.parent : statement;
  const fn = body?.type === AST_NODE_TYPES.BlockStatement ? body.parent : body;
  if (
    fn === undefined ||
    (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
      fn.type !== AST_NODE_TYPES.FunctionExpression)
  ) {
    return null;
  }
  const runner = fn.parent;
  if (runner.type !== AST_NODE_TYPES.CallExpression || !isRunnerCall(runner)) {
    return null;
  }
  const context = fn.params[0];
  return context?.type === AST_NODE_TYPES.Identifier ? context.name : null;
}

export const skippedTestsNeedTrackingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Skipped tests (`.skip` / `.fixme` / `xit` / `xdescribe`, and unconditional `node:test` `{ skip }` / `{ todo }` / `t.skip()`) must carry a tracking marker (an issue URL or `TODO(@owner)`) on or above the line, so the debt has an owner instead of rotting silently.',
    },
    schema: [optionSchema],
    messages: {
      needsTracking:
        'Skipped test `{{label}}` has no tracking marker. Add an issue URL or `TODO(@owner)` on the same line or above so the skip has an owner.',
    },
  },
  defaultOptions: [{ markers: [...DEFAULT_MARKERS], lookback: DEFAULT_LOOKBACK }],
  create(context, [options]) {
    const markerSources = options.markers ?? DEFAULT_MARKERS;
    const markers = markerSources.map((source) => new RegExp(source, 'u'));
    const lookback = options.lookback ?? DEFAULT_LOOKBACK;
    const lines = context.sourceCode.lines;

    function hasTrackingMarker(fromLine: number, toLine: number): boolean {
      const window = lines.slice(fromLine, toLine + 1).join('\n');
      return markers.some((marker) => marker.test(window));
    }

    /**
     * Report `label` on `node` unless a marker sits on the line `node` ends on
     * or in the lookback window above it.
     */
    function check(node: TSESTree.Node, label: string): void {
      const index = node.loc.end.line - 1;
      if (hasTrackingMarker(Math.max(0, index - lookback), index)) {
        return;
      }
      context.report({ node, messageId: 'needsTracking', data: { label } });
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (isRunnerCall(node)) {
          for (const argument of node.arguments) {
            if (argument.type !== AST_NODE_TYPES.ObjectExpression) {
              continue;
            }
            for (const property of argument.properties) {
              if (property.type !== AST_NODE_TYPES.Property) {
                continue;
              }
              const key = propertyKey(property);
              if (key !== null && NODE_TEST_SKIPS.has(key) && isUnconditionalSkip(property.value)) {
                check(property, `{ ${key} }`);
              }
            }
          }
        }
        const callee = node.callee;
        const label = skipLabel(callee);
        if (label !== null) {
          check(callee, label);
          return;
        }
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !NODE_TEST_SKIPS.has(callee.property.name) ||
          callee.object.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        if (unconditionalContextName(node) === callee.object.name) {
          check(callee, `${callee.object.name}.${callee.property.name}(`);
        }
      },
    };
  },
});
