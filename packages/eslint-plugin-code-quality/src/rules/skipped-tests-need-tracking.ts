import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

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
 * Faithful to the original text-scanning implementation: the source is scanned
 * line by line rather than through the AST, so a marker in a trailing or
 * preceding comment (or anywhere in the lookback window) is honoured exactly as
 * a human reviewer would read it.
 *
 * `node:test` skips a test through its options (`test('x', { skip: true })`,
 * `{ todo: 'reason' }`) or its context (`t.skip()`, `t.todo()`). Those are read
 * from the AST, because only an UNCONDITIONAL skip is debt: `{ skip:
 * process.platform === 'win32' }` or a `t.skip('POSIX only')` inside an `if` is
 * a platform guard, not a test someone meant to come back to. The marker is
 * looked up the same way, from the line of the option or the call.
 */
const SKIP_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:it|test|describe)\.skip\s*\(/u, label: '.skip(' },
  { pattern: /\b(?:it|test|describe)\.fixme\s*\(/u, label: '.fixme(' },
  { pattern: /\bxit\s*\(/u, label: 'xit(' },
  { pattern: /\bxdescribe\s*\(/u, label: 'xdescribe(' },
  { pattern: /\bxtest\s*\(/u, label: 'xtest(' },
];

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

/** Root identifier of a test callee: `test`, `describe.skip`, `test.each(table)`. */
function runnerName(callee: TSESTree.Node): string | null {
  let current: TSESTree.Node = callee;
  while (
    current.type === AST_NODE_TYPES.MemberExpression ||
    current.type === AST_NODE_TYPES.CallExpression
  ) {
    current = current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.callee;
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : null;
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

/** True when an option value always skips: `true`, a non-empty string. A computed value is a guard. */
function isUnconditionalSkip(value: TSESTree.Node): boolean {
  if (value.type === AST_NODE_TYPES.Literal) {
    return value.value === true || (typeof value.value === 'string' && value.value !== '');
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
  const statement = node.parent;
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

    /** Report `label` on the 1-based `line` unless a marker sits in its lookback window. */
    function checkLine(line: number, label: string): void {
      const index = line - 1;
      if (hasTrackingMarker(Math.max(0, index - lookback), index)) {
        return;
      }
      const text = lines[index] ?? '';
      context.report({
        loc: { start: { line, column: 0 }, end: { line, column: text.length } },
        messageId: 'needsTracking',
        data: { label },
      });
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
                checkLine(property.loc.start.line, `{ ${key} }`);
              }
            }
          }
        }
        const callee = node.callee;
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
          checkLine(node.loc.start.line, `${callee.object.name}.${callee.property.name}(`);
        }
      },
      Program(): void {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          for (const { pattern, label } of SKIP_PATTERNS) {
            if (!pattern.test(line)) {
              continue;
            }
            const start = Math.max(0, i - lookback);
            if (hasTrackingMarker(start, i)) {
              continue;
            }
            context.report({
              loc: {
                start: { line: i + 1, column: 0 },
                end: { line: i + 1, column: line.length },
              },
              messageId: 'needsTracking',
              data: { label },
            });
          }
        }
      },
    };
  },
});
