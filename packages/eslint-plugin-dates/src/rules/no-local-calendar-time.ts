import { AST_NODE_TYPES, matchesAnyGlob, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import {
  allowInSchema,
  calendarHint,
  calendarModuleSchema,
  calledMethod,
  isDateStaticCall,
  numberValue,
  staticString,
  unwrap,
} from '../utils/dates';

const RULE_NAME = 'no-local-calendar-time';

/** The shapes this rule can check, each switched on through `checks`. */
const CHECKS = ['localAccessor', 'dateOnlyParse', 'isoDaySlice', 'instantVsNow'] as const;
type Check = (typeof CHECKS)[number];

const DEFAULT_CHECKS: readonly Check[] = ['localAccessor', 'dateOnlyParse', 'isoDaySlice'];

export interface NoLocalCalendarTimeOptions {
  /** Globs of the files exempt from the rule: the calendar module itself. */
  readonly allowIn?: readonly string[];
  /** The shapes to report. */
  readonly checks?: readonly Check[];
  /** Import path of the calendar module, named in the message. */
  readonly calendarModule?: string;
}

type RuleOptions = [NoLocalCalendarTimeOptions];
type MessageIds = Check;

/*
 * A calendar day (a due date, a birthday, a leave day) is not an instant. Code
 * that stores it as a `Date` has to read it back in one agreed zone, and four
 * shapes read it in whatever zone the machine happens to be in. Each looks right
 * on a developer's laptop and moves the day by one on a server, a CI runner or a
 * browser in another zone:
 *
 * - the local accessors and setters (`getDate()`, `setHours()`) use the
 *   machine's zone;
 * - `new Date('2026-03-31')` parses a date-only string as UTC midnight, which
 *   is 30 March in any zone west of UTC once a local accessor or formatter
 *   reads it;
 * - `date.toISOString().slice(0, 10)` is the UTC day of an instant, which is
 *   yesterday or tomorrow near midnight anywhere but UTC;
 * - `due.getTime() < Date.now()` treats a day stored as midnight as over from
 *   its first minute (opt-in: it is right for a real instant such as a token
 *   expiry, and the rule cannot tell the two apart).
 *
 * The rule is syntactic: methods are matched by name on any receiver, without
 * type information. A helper that wraps a local getter is reported at the
 * helper, which is where the fix belongs, and the calendar module that does
 * this on purpose goes in `allowIn`.
 */

const LOCAL_ACCESSORS: ReadonlySet<string> = new Set([
  'getFullYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'setFullYear',
  'setMonth',
  'setDate',
  'setHours',
  'setMinutes',
]);

const SUBSTRING_METHODS: ReadonlySet<string> = new Set(['slice', 'substring', 'substr']);
const RELATIONAL_OPERATORS: ReadonlySet<string> = new Set(['<', '>', '<=', '>=']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

/** True for `<expr>.toISOString()`. */
function isToIsoString(node: TSESTree.Node): boolean {
  return calledMethod(node) === 'toISOString';
}

/** The receiver of `receiver.method(...)`, unwrapped. */
function receiverOf(call: TSESTree.CallExpression): TSESTree.Node | null {
  const callee = unwrap(call.callee);
  return callee.type === AST_NODE_TYPES.MemberExpression ? unwrap(callee.object) : null;
}

/** True for `.slice(0, 10)`, `.substring(0, 10)` and `.substr(0, 10)` on `toISOString()`. */
function isIsoDaySubstring(call: TSESTree.CallExpression): boolean {
  const method = calledMethod(call);
  if (method === null || !SUBSTRING_METHODS.has(method)) return false;
  const [start, length] = call.arguments;
  if (start === undefined || length === undefined || numberValue(start) !== 0) return false;
  if (numberValue(length) !== 10) return false;
  const receiver = receiverOf(call);
  return receiver !== null && isToIsoString(receiver);
}

/** True for `toISOString().split('T')[0]`. */
function isIsoDaySplit(node: TSESTree.MemberExpression): boolean {
  if (!node.computed || numberValue(node.property) !== 0) return false;
  const split = unwrap(node.object);
  if (split.type !== AST_NODE_TYPES.CallExpression || calledMethod(split) !== 'split') return false;
  const [separator] = split.arguments;
  if (separator === undefined || staticString(separator) !== 'T') return false;
  const receiver = receiverOf(split);
  return receiver !== null && isToIsoString(receiver);
}

/** True for `new Date('YYYY-MM-DD')` and `Date.parse('YYYY-MM-DD')`. */
function isDateOnlyParse(node: TSESTree.NewExpression | TSESTree.CallExpression): boolean {
  const isDateConstructor =
    node.type === AST_NODE_TYPES.NewExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'Date';
  if (!isDateConstructor && !isDateStaticCall(node, 'parse')) return false;
  if (node.arguments.length !== 1) return false;
  const [argument] = node.arguments;
  const text = argument === undefined ? null : staticString(argument);
  return text !== null && DATE_ONLY.test(text);
}

export const noLocalCalendarTimeRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow reading a calendar day through the machine's time zone: local `Date` accessors, `new Date('YYYY-MM-DD')`, and `toISOString().slice(0, 10)`.",
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
              'The shapes to report: `localAccessor`, `dateOnlyParse`, `isoDaySlice` and `instantVsNow`. Defaults to every shape but `instantVsNow`, which is right for real instants and only fits a codebase that stores calendar days as midnight `Date`s.',
          },
          calendarModule: calendarModuleSchema,
        },
      },
    ],
    messages: {
      localAccessor:
        "`{{method}}()` reads the machine's time zone, so the same stored day is a different date on a server or in a browser in another zone. {{hint}}",
      dateOnlyParse:
        '`{{text}}` parses as midnight UTC, so a local accessor or formatter shows the previous day in every zone west of UTC. {{hint}}',
      isoDaySlice:
        '`toISOString()` cut to its first 10 characters is the UTC day of the instant, which is yesterday or tomorrow near midnight in any other zone. {{hint}}',
      instantVsNow:
        '`.getTime()` compared with `Date.now()`. For a calendar day stored as midnight this says the day is over from its first minute, so a deadline is overdue on its own last day. {{hint}}',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (matchesAnyGlob(context.filename, options.allowIn ?? [])) return {};

    const checks: ReadonlySet<Check> = new Set(options.checks ?? DEFAULT_CHECKS);
    const hint = calendarHint(options.calendarModule);

    const reportDateOnly = (node: TSESTree.NewExpression | TSESTree.CallExpression): void => {
      if (!checks.has('dateOnlyParse') || !isDateOnlyParse(node)) return;
      const text = context.sourceCode.getText(node);
      context.report({ node, messageId: 'dateOnlyParse', data: { text, hint } });
    };

    return {
      NewExpression: reportDateOnly,
      CallExpression(node): void {
        reportDateOnly(node);
        if (checks.has('isoDaySlice') && isIsoDaySubstring(node)) {
          context.report({ node, messageId: 'isoDaySlice', data: { hint } });
          return;
        }
        const method = calledMethod(node);
        if (checks.has('localAccessor') && method !== null && LOCAL_ACCESSORS.has(method)) {
          context.report({ node, messageId: 'localAccessor', data: { method, hint } });
        }
      },
      MemberExpression(node): void {
        if (checks.has('isoDaySlice') && isIsoDaySplit(node)) {
          context.report({ node, messageId: 'isoDaySlice', data: { hint } });
        }
      },
      BinaryExpression(node): void {
        if (!checks.has('instantVsNow') || !RELATIONAL_OPERATORS.has(node.operator)) return;
        const isGetTime = (side: TSESTree.Node): boolean => calledMethod(side) === 'getTime';
        const isNow = (side: TSESTree.Node): boolean => isDateStaticCall(side, 'now');
        if ((isGetTime(node.left) && isNow(node.right)) || (isNow(node.left) && isGetTime(node.right))) {
          context.report({ node, messageId: 'instantVsNow', data: { hint } });
        }
      },
    };
  },
});
