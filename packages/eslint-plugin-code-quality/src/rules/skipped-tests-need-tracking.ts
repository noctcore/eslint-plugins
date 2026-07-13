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
 */
const SKIP_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:it|test|describe)\.skip\s*\(/u, label: '.skip(' },
  { pattern: /\b(?:it|test|describe)\.fixme\s*\(/u, label: '.fixme(' },
  { pattern: /\bxit\s*\(/u, label: 'xit(' },
  { pattern: /\bxdescribe\s*\(/u, label: 'xdescribe(' },
  { pattern: /\bxtest\s*\(/u, label: 'xtest(' },
];

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

export const skippedTestsNeedTrackingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Skipped tests (`.skip` / `.fixme` / `xit` / `xdescribe`) must carry a tracking marker (an issue URL or `TODO(@owner)`) on or above the line, so the debt has an owner instead of rotting silently.',
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

    return {
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
