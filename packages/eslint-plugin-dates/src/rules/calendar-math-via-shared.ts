import { AST_NODE_TYPES, fileMatchesAnyGlob, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import {
  allowInSchema,
  calendarHint,
  calendarModuleSchema,
  calledMethod,
  isDateStaticCall,
  numberValue,
  unwrap,
} from '../utils/dates';

const RULE_NAME = 'calendar-math-via-shared';

/** The shapes this rule can check, each switched on through `checks`. */
const CHECKS = ['utcAccessor', 'dateUtc', 'setMonth', 'msPerDay'] as const;
type Check = (typeof CHECKS)[number];

export interface CalendarMathViaSharedOptions {
  /** Globs of the files exempt from the rule: the calendar module itself. */
  readonly allowIn?: readonly string[];
  /** The shapes to report. */
  readonly checks?: readonly Check[];
  /** Import path of the calendar module, named in the message. */
  readonly calendarModule?: string;
}

type RuleOptions = [CalendarMathViaSharedOptions];
type MessageIds = 'handRolledCalendarMath' | 'msPerDay';

/*
 * Calendar arithmetic has edges every hand-rolled copy re-derives on its own:
 * a month added to 31 January, a day added across a daylight saving change, the
 * day an instant falls on just after midnight, an end date that is exclusive.
 * The UTC accessors are the correct tools, which is why copies of them spread:
 * each one looks right in isolation, and two of them disagree on an edge
 * nobody tested. The answers belong in one module with one set of tests, and
 * this rule keeps the arithmetic there.
 *
 * - `getUTC*` / `setUTC*` and `Date.UTC()` are the building blocks of day
 *   arithmetic;
 * - `setMonth` overflows (31 January plus one month is 3 March) in any zone;
 * - `86_400_000`, or `24 * 60 * 60 * 1000` in any order, assumes every day is
 *   24 hours long, which is false twice a year wherever clocks change.
 *
 * The rule is syntactic: methods are matched by name on any receiver, and the
 * calendar module goes in `allowIn`.
 */

const UTC_ACCESSOR = /^(?:get|set)UTC[A-Z]/u;
const MS_PER_DAY = 86_400_000;

/** How the call reads in the message for the call checks, or null. */
function calendarCall(node: TSESTree.CallExpression, checks: ReadonlySet<Check>): string | null {
  if (checks.has('dateUtc') && isDateStaticCall(node, 'UTC')) return 'Date.UTC()';
  const method = calledMethod(node);
  if (method === null) return null;
  if (checks.has('utcAccessor') && UTC_ACCESSOR.test(method)) return `.${method}()`;
  if (checks.has('setMonth') && method === 'setMonth') return '.setMonth()';
  return null;
}

/** True for a `*` node, under parentheses and type wrappers. */
function isProduct(node: TSESTree.Node): node is TSESTree.BinaryExpression {
  return node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '*';
}

/** The number-literal factors of a `*` chain, collected through nested products. */
function literalFactors(node: TSESTree.Node, out: number[]): number[] {
  const inner = unwrap(node);
  if (isProduct(inner)) {
    literalFactors(inner.left, out);
    literalFactors(inner.right, out);
    return out;
  }
  const value = numberValue(inner);
  if (value !== null) out.push(value);
  return out;
}

/** True when a `*` node sits inside a larger `*` chain, which is reported instead. */
function isNestedProduct(node: TSESTree.BinaryExpression): boolean {
  let parent = node.parent;
  while (
    parent.type === AST_NODE_TYPES.TSAsExpression ||
    parent.type === AST_NODE_TYPES.TSNonNullExpression ||
    parent.type === AST_NODE_TYPES.TSSatisfiesExpression
  ) {
    parent = parent.parent;
  }
  return isProduct(parent);
}

/**
 * True when a `*` chain's literal factors multiply to a day in milliseconds,
 * possibly beside other factors: `24 * 60 * 60 * 1000`, `days * 86_400 * 1000`.
 */
function isMsPerDayProduct(node: TSESTree.BinaryExpression): boolean {
  const factors = literalFactors(node, []);
  if (factors.length < 2) return false;
  return factors.reduce((product, factor) => product * factor, 1) === MS_PER_DAY;
}

export const calendarMathViaSharedRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hand-rolled calendar arithmetic (`getUTC*` / `setUTC*`, `Date.UTC()`, `setMonth`, and milliseconds-per-day constants) outside the calendar module listed in `allowIn`.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: allowInSchema,
          checks: {
            type: 'array',
            items: { type: 'string', enum: [...CHECKS] },
            uniqueItems: true,
            description:
              'The shapes to report: `utcAccessor`, `dateUtc`, `setMonth` and `msPerDay`. Defaults to all four.',
          },
          calendarModule: calendarModuleSchema,
        },
      },
    ],
    messages: {
      handRolledCalendarMath:
        'Hand-rolled calendar arithmetic: `{{call}}`. Every copy re-derives the month-end and midnight edges on its own, outside the calendar module and its tests. {{hint}}',
      msPerDay:
        '`{{text}}` treats a day as 24 hours, which it is not on the two days a year clocks change. Add or compare calendar days through the calendar module. {{hint}}',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (fileMatchesAnyGlob(context.filename, options.allowIn ?? [], context.cwd)) return {};

    const checks: ReadonlySet<Check> = new Set(options.checks ?? CHECKS);
    const hint = calendarHint(options.calendarModule);

    const reportMsPerDay = (node: TSESTree.Node): void => {
      const text = context.sourceCode.getText(node);
      context.report({ node, messageId: 'msPerDay', data: { text, hint } });
    };

    return {
      CallExpression(node): void {
        const call = calendarCall(node, checks);
        if (call !== null) {
          context.report({ node, messageId: 'handRolledCalendarMath', data: { call, hint } });
        }
      },
      Literal(node): void {
        if (checks.has('msPerDay') && numberValue(node) === MS_PER_DAY) reportMsPerDay(node);
      },
      BinaryExpression(node): void {
        if (!checks.has('msPerDay') || !isProduct(node) || isNestedProduct(node)) return;
        if (isMsPerDayProduct(node)) reportMsPerDay(node);
      },
    };
  },
});
