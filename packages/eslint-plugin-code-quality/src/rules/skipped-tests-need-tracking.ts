import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { calleeName, runnerName } from '../utils/ast';

const RULE_NAME = 'skipped-tests-need-tracking';

export interface SkippedTestsNeedTrackingOptions {
  /** Regex sources (compiled with the `u` flag) any of which satisfies the
   * tracking requirement. The default accepts a URL or `TODO(@owner)`. */
  readonly markers?: readonly string[];
  /** How many lines above the skip a tracking marker may live to count. */
  readonly lookback?: number;
}

type RuleOptions = [SkippedTestsNeedTrackingOptions];
type MessageIds = 'needsTracking' | 'addTodoMarker';

/*
 * `.skip` / `.fixme` / `xit` / `xdescribe` are escape hatches that rot into
 * permanent dark zones if left unowned. Each must carry a tracking marker (an
 * issue URL or `TODO(@owner)`) within the lookback window so the debt has a
 * human attached. `.only` is NOT listed here: `no-focused-tests` bans it
 * outright, so it can never legitimately appear with or without tracking.
 *
 * A skip is found in the AST, as a call, so the same text inside a string, a
 * template literal or a comment is not one. The tracking marker is looked up in
 * COMMENTS only: a comment on the skip's line, or a comment that ends within
 * `lookback` lines above it, together with the run of comments it belongs to
 * (a multi-line `//` block counts as one). Code in the window never counts, so
 * a `const BASE = 'http://localhost:3000'` above a skip is not a marker.
 *
 * A modifier anywhere in the runner's member chain skips it:
 * `it.concurrent.skip(...)`, `it.skip.each([...])(...)`. Playwright's
 * conditional form, `test.skip(browserName === 'webkit', 'reason')`, is a
 * platform guard like a `node:test` computed `skip` and is not reported: the
 * first argument is a condition rather than a test name, and no argument is
 * the test body.
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
const DEFAULT_LOOKBACK = 3;

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

/**
 * The label of a skipping runner call, else null: `xit(...)`, `it.skip(...)`,
 * and a skip modifier anywhere in the chain (`it.concurrent.skip(...)`,
 * `test.describe.fixme(...)`, `it.skip.each([...])`).
 */
function skipLabel(callee: TSESTree.Node): string | null {
  const name = calleeName(callee);
  if (name === null) {
    return null;
  }
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return SKIPPED_RUNNERS.has(name) ? `${name}(` : null;
  }
  let modifier: string | null = null;
  let node: TSESTree.Node = callee;
  while (node.type === AST_NODE_TYPES.MemberExpression) {
    if (node.computed || node.property.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    if (SKIP_MODIFIERS.has(node.property.name)) {
      modifier = node.property.name;
    }
    node = node.object;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  if (modifier !== null && SKIPPABLE_RUNNERS.has(node.name)) {
    return `.${modifier}(`;
  }
  return null;
}

function isFunctionNode(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.ArrowFunctionExpression || node.type === AST_NODE_TYPES.FunctionExpression;
}

/**
 * Playwright's conditional skip, `test.skip(condition, 'reason')`: the first
 * argument is not a test name (string, template or `true`) and no argument is
 * the test body. `test.skip()` with no argument skips unconditionally.
 */
function isConditionalModifierSkip(call: TSESTree.CallExpression): boolean {
  const [first, ...rest] = call.arguments;
  if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) {
    return false;
  }
  const nameLike =
    first.type === AST_NODE_TYPES.TemplateLiteral ||
    (first.type === AST_NODE_TYPES.Literal && (typeof first.value === 'string' || first.value === true));
  return !nameLike && !rest.some(isFunctionNode);
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
    hasSuggestions: true,
    schema: [optionSchema],
    messages: {
      needsTracking:
        'Skipped test `{{label}}` has no tracking marker. Add an issue URL or `TODO(@owner)` in a comment on the same line or just above so the skip has an owner.',
      addTodoMarker: 'Add a `// TODO(@owner):` comment above the skip.',
    },
  },
  defaultOptions: [{ markers: [...DEFAULT_MARKERS], lookback: DEFAULT_LOOKBACK }],
  create(context, [options]) {
    const markerSources = options.markers ?? DEFAULT_MARKERS;
    const markers = markerSources.map((source) => new RegExp(source, 'u'));
    const lookback = options.lookback ?? DEFAULT_LOOKBACK;
    const sourceCode = context.sourceCode;
    const comments = sourceCode.getAllComments();
    const commentsByEndLine = new Map<number, TSESTree.Comment[]>();
    for (const comment of comments) {
      const list = commentsByEndLine.get(comment.loc.end.line) ?? [];
      list.push(comment);
      commentsByEndLine.set(comment.loc.end.line, list);
    }

    function hasMarker(comment: TSESTree.Comment): boolean {
      return markers.some((marker) => marker.test(comment.value));
    }

    /**
     * A marker in a comment on `line` (1-based), or in a comment ending within
     * `lookback` lines above it, or anywhere in the run of adjacent comments
     * such a comment belongs to.
     */
    function hasTrackingMarker(line: number): boolean {
      const onLine = comments.some((comment) => comment.loc.start.line <= line && comment.loc.end.line >= line);
      if (onLine && comments.some((comment) => comment.loc.start.line <= line && comment.loc.end.line >= line && hasMarker(comment))) {
        return true;
      }
      for (let end = line - 1; end >= Math.max(1, line - lookback); end -= 1) {
        let run = commentsByEndLine.get(end);
        while (run !== undefined && run.length > 0) {
          if (run.some(hasMarker)) {
            return true;
          }
          const startLine = Math.min(...run.map((comment) => comment.loc.start.line));
          run = commentsByEndLine.get(startLine - 1);
        }
      }
      return false;
    }

    /** A skip reason given as text (`{ skip: 'https://...' }`, `t.skip('TODO(@a)')`) may carry the marker. */
    function reasonHasMarker(reason: TSESTree.Node): boolean {
      const text =
        reason.type === AST_NODE_TYPES.Literal && typeof reason.value === 'string'
          ? reason.value
          : reason.type === AST_NODE_TYPES.TemplateLiteral
            ? reason.quasis.map((quasi) => quasi.value.cooked ?? '').join('')
            : null;
      return text !== null && markers.some((marker) => marker.test(text));
    }

    /**
     * Report `label` on `node` unless a comment marker sits on the line `node`
     * ends on or in the lookback window above it. The suggestion inserts a
     * `TODO(@owner)` line above the skip for the author to complete.
     */
    function check(node: TSESTree.Node, label: string, reason?: TSESTree.Node): void {
      if (hasTrackingMarker(node.loc.end.line) || (reason !== undefined && reasonHasMarker(reason))) {
        return;
      }
      const startLine = node.loc.start.line;
      const lineText = sourceCode.lines[startLine - 1] ?? '';
      const indent = /^\s*/u.exec(lineText)?.[0] ?? '';
      const lineStart = sourceCode.getIndexFromLoc({ line: startLine, column: 0 });
      context.report({
        node,
        messageId: 'needsTracking',
        data: { label },
        suggest: [
          {
            messageId: 'addTodoMarker',
            fix: (fixer) => fixer.insertTextBeforeRange([lineStart, lineStart], `${indent}// TODO(@owner): link the tracking issue\n`),
          },
        ],
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
                check(property, `{ ${key} }`, property.value);
              }
            }
          }
        }
        const callee = node.callee;
        const label = skipLabel(callee);
        if (label !== null) {
          // Only a direct `X.skip(...)` call can be Playwright's conditional form; `it.skip.each([...])` cannot.
          const direct = SKIP_MODIFIERS.has(calleeName(callee) ?? '');
          if (label.startsWith('.') && direct && isConditionalModifierSkip(node)) {
            return;
          }
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
          const reason = node.arguments[0];
          check(
            callee,
            `${callee.object.name}.${callee.property.name}(`,
            reason?.type === AST_NODE_TYPES.SpreadElement ? undefined : reason,
          );
        }
      },
    };
  },
});
