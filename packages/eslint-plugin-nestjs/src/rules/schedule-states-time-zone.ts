import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { directProperty, isUndefined, queueMethod, queuePatternRegExp } from '../utils/queue';

const RULE_NAME = 'schedule-states-time-zone';

export interface ScheduleStatesTimeZoneOptions {
  /** When set, the zone must be one of these string literals. */
  readonly zones?: readonly string[];
}

type RuleOptions = [ScheduleStatesTimeZoneOptions];
type MessageIds = 'cronZone' | 'schedulerZone' | 'repeatZone';

/** Any receiver: `upsertJobScheduler` and `repeat` are BullMQ-specific enough. */
const ANY_RECEIVER = queuePatternRegExp('.');

/**
 * Whether a zone property states a zone. Without `zones`, any value but
 * `undefined` does (a constant such as `APP_TIME_ZONE` is fine); with `zones`,
 * only one of those string literals does.
 */
function statesZone(
  property: TSESTree.Property | undefined,
  zones: ReadonlySet<string> | null,
): boolean {
  if (property === undefined || isUndefined(property.value)) return false;
  if (zones === null) return true;
  const value = property.value;
  return (
    value.type === AST_NODE_TYPES.Literal && typeof value.value === 'string' && zones.has(value.value)
  );
}

/** An `every:` interval has no wall-clock hour to state, unless it is `every: undefined`. */
function isInterval(spec: TSESTree.Node | undefined): boolean {
  const every = directProperty(spec, 'every');
  return every !== undefined && !isUndefined(every.value);
}

/*
 * Every schedule states its time zone where the reader can see it: a
 * `@Cron(expr, { timeZone })` from `@nestjs/schedule`, a BullMQ
 * `upsertJobScheduler(id, { pattern, tz })`, and a legacy repeatable job
 * `queue.add(name, data, { repeat: { pattern, tz } })`. Left implicit, the
 * schedule runs in the host's zone, so "every day at 03:00" means one instant
 * on a laptop and another in the container, and moves with daylight saving.
 */
export const scheduleStatesTimeZoneRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a `@Cron` to state `timeZone` (or `utcOffset`) and a BullMQ cron schedule to state `tz`, so it does not run in whatever zone the host has.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          zones: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            minItems: 1,
            description:
              'When set, the stated zone must be one of these string literals (for example `["UTC"]`); a variable or any other zone is reported. Unset, any stated value but `undefined` passes.',
          },
        },
      },
    ],
    messages: {
      cronZone: "State the schedule's time zone: `@Cron(expr, { timeZone: {{zones}} })`.",
      schedulerZone:
        "State the job scheduler's time zone: `upsertJobScheduler(id, { pattern, tz: {{zones}} })`.",
      repeatZone: "State the repeatable job's time zone: `repeat: { pattern, tz: {{zones}} }`.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const zones = options.zones === undefined ? null : new Set(options.zones);
    const zoneList =
      zones === null ? "'UTC'" : [...zones].map((zone) => `'${zone}'`).join(' or ');

    return {
      Decorator(node): void {
        const call = node.expression;
        if (
          call.type !== AST_NODE_TYPES.CallExpression ||
          call.callee.type !== AST_NODE_TYPES.Identifier ||
          call.callee.name !== 'Cron'
        ) {
          return;
        }
        const cronOptions = call.arguments[1];
        const stated =
          statesZone(directProperty(cronOptions, 'timeZone'), zones) ||
          (zones === null && statesZone(directProperty(cronOptions, 'utcOffset'), null));
        if (!stated) {
          context.report({ node, messageId: 'cronZone', data: { zones: zoneList } });
        }
      },
      CallExpression(node): void {
        const method = queueMethod(node, ANY_RECEIVER);
        if (method === 'upsertJobScheduler') {
          const spec = node.arguments[1];
          if (isInterval(spec)) return;
          if (!statesZone(directProperty(spec, 'tz'), zones)) {
            context.report({ node, messageId: 'schedulerZone', data: { zones: zoneList } });
          }
          return;
        }
        if (method !== 'add') return;
        const repeat = directProperty(node.arguments[2], 'repeat')?.value;
        if (repeat?.type !== AST_NODE_TYPES.ObjectExpression || isInterval(repeat)) return;
        if (!statesZone(directProperty(repeat, 'tz'), zones)) {
          context.report({ node: repeat, messageId: 'repeatZone', data: { zones: zoneList } });
        }
      },
    };
  },
});
