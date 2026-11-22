import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  DEFAULT_EVENT_FIELD,
  DEFAULT_LOG_METHODS,
  DEFAULT_LOGGERS,
  findProperty,
  hasSpread,
  type LoggerCallOptions,
  loggerCallMatcher,
  loggerCallMethod,
  loggerCallOptionProperties,
  logPayload,
} from '../utils';

const RULE_NAME = 'require-event-field';

export interface RequireEventFieldOptions extends LoggerCallOptions {
  readonly eventField?: string;
}

type RuleOptions = [RequireEventFieldOptions];
type MessageIds = 'missingEventField' | 'missingPayload';

/*
 * A log line found by its message text breaks the day someone rewords the
 * message: the dashboard, the alert and the saved search all match on a
 * substring that no longer exists. A stable event identifier in the structured
 * payload (`{ event: 'invoice.paid' }`) is what those queries should key on.
 *
 * Matched structurally, with the logger matching every observability rule
 * shares: a `<logger>.<method>(...)` call. Its object-literal arguments are the
 * payload (pino puts it first, most other loggers second, so position does not
 * matter). The call is reported when
 *   - some object-literal argument exists and none has the event field, or
 *   - there is no payload at all: every argument is a string, number or
 *     template literal.
 *
 * What the rule cannot see it accepts, because guessing would report correct
 * code: an object with a spread (`{ ...ctx, userId }`) or a computed key may
 * supply the field, and an argument that is an identifier, a call or a member
 * access (`log.info('paid', ctx)`) may be a payload built elsewhere.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    eventField: {
      type: 'string',
      minLength: 1,
      default: DEFAULT_EVENT_FIELD,
      description: 'The payload key that holds the event identifier.',
    },
    ...loggerCallOptionProperties,
  },
};

/** True when the object may hold a key the rule cannot read (a spread or a computed key). */
function mayHideField(object: TSESTree.ObjectExpression): boolean {
  return (
    hasSpread(object) ||
    object.properties.some(
      (property) => property.type === AST_NODE_TYPES.Property && property.computed,
    )
  );
}

export const requireEventFieldRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A logger call must carry a stable event identifier in its structured payload, so log searches, dashboards and alerts do not match on message text.',
    },
    schema: [optionSchema],
    messages: {
      missingEventField:
        'This `.{{method}}(...)` payload has no `{{field}}` field. Add a stable identifier (e.g. `{ {{field}}: \'invoice.paid\' }`) so searches and alerts key on it instead of the message text.',
      missingPayload:
        'This `.{{method}}(...)` call has no structured payload, so it carries no `{{field}}` field. Pass one with a stable identifier (e.g. `{ {{field}}: \'invoice.paid\' }`) so searches and alerts key on it instead of the message text.',
    },
  },
  defaultOptions: [
    { eventField: DEFAULT_EVENT_FIELD, loggers: DEFAULT_LOGGERS, methods: DEFAULT_LOG_METHODS },
  ],
  create(context, [options]) {
    const matcher = loggerCallMatcher(options);
    const field = options.eventField ?? DEFAULT_EVENT_FIELD;

    return {
      CallExpression(node): void {
        const method = loggerCallMethod(node, matcher);
        if (method === null) {
          return;
        }
        const payload = logPayload(node);
        if (payload.opaque) {
          return;
        }
        const [first] = payload.objects;
        if (first === undefined) {
          context.report({ node, messageId: 'missingPayload', data: { method, field } });
          return;
        }
        const covered = payload.objects.some(
          (object) => findProperty(object, field) !== null || mayHideField(object),
        );
        if (!covered) {
          context.report({ node: first, messageId: 'missingEventField', data: { method, field } });
        }
      },
    };
  },
});
