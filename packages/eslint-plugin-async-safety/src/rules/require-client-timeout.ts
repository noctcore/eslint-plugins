import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { calleeText } from '../utils';

const RULE_NAME = 'require-client-timeout';

/** One client constructor or factory whose options must bound its waits. */
export interface ClientTimeoutSpec {
  /** Dotted callee text, matched literally (`S3Client`, `nodemailer.createTransport`). */
  readonly callee: string;
  /** Match `new <callee>(...)` instead of `<callee>(...)`. Default `false`. */
  readonly construct?: boolean;
  /** The options object must carry at least one of these top-level keys. */
  readonly requireAnyOf: readonly string[];
}

export interface RequireClientTimeoutOptions {
  readonly clients?: readonly ClientTimeoutSpec[];
}

type RuleOptions = [RequireClientTimeoutOptions];
type MessageIds = 'missingTimeout';

/*
 * A network client built with no timeout (an S3 client with no request handler
 * timeouts, an SMTP transport with no connection timeout) waits forever on a
 * peer that accepts and never answers. `require-fetch-timeout` covers `fetch`;
 * this covers clients configured once at construction. The rule ships knowing
 * no client: every entry in `clients` is the consumer's.
 *
 * Same precision contract as `require-fetch-timeout`: no types, and silent
 * whenever it cannot SEE the options:
 *   - any spread argument (`new Client(...args)`) → skipped;
 *   - an options object literal with a `...spread` property → skipped;
 *   - an options slot that is an identifier/call/member (`new Client(config)`)
 *     → skipped, because that bag may already set a timeout.
 * It reports when the options are plainly timeout-free: a visible object literal
 * with none of the `requireAnyOf` keys, or no arguments beyond string/template
 * literals (including no arguments at all).
 */
const clientSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['callee', 'requireAnyOf'],
  properties: {
    callee: { type: 'string', minLength: 1 },
    construct: { type: 'boolean', default: false },
    requireAnyOf: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
      uniqueItems: true,
    },
  },
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clients: { type: 'array', items: clientSchema, default: [] },
  },
};

/** A string or template literal: a connection URL, never an options bag. */
function isUrlLike(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.TemplateLiteral ||
    (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string')
  );
}

interface ObjectProbe {
  readonly satisfied: boolean; // has one of the required keys
  readonly opaque: boolean; // has a spread, cannot verify
}

function probeOptionsObject(
  object: TSESTree.ObjectExpression,
  keys: ReadonlySet<string>,
): ObjectProbe {
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      return { satisfied: false, opaque: true };
    }
    const key = property.key;
    const name =
      key.type === AST_NODE_TYPES.Identifier
        ? key.name
        : key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string'
          ? key.value
          : null;
    if (name !== null && keys.has(name)) {
      return { satisfied: true, opaque: false };
    }
  }
  return { satisfied: false, opaque: false };
}

/** Whether a matched call's arguments visibly lack every required key. */
function lacksTimeout(
  args: readonly TSESTree.CallExpressionArgument[],
  keys: ReadonlySet<string>,
): boolean {
  if (args.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) {
    return false;
  }
  const objectArgs = args.filter(
    (arg): arg is TSESTree.ObjectExpression => arg.type === AST_NODE_TYPES.ObjectExpression,
  );
  if (objectArgs.length > 0) {
    const probes = objectArgs.map((object) => probeOptionsObject(object, keys));
    return !probes.some((probe) => probe.satisfied || probe.opaque);
  }
  // No options object literal: only plainly option-free argument lists count.
  return args.every(isUrlLike);
}

export const requireClientTimeoutRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A configured network client must be constructed with a timeout option; an unbounded client can hang forever.',
    },
    schema: [optionSchema],
    messages: {
      missingTimeout:
        '`{{callee}}` is created without a timeout. Set one of {{keys}} in its options so a stalled peer cannot hang the caller indefinitely.',
    },
  },
  defaultOptions: [{ clients: [] }],
  create(context, [options]) {
    const clients = (options.clients ?? []).map((client) => ({
      callee: client.callee,
      construct: client.construct ?? false,
      keys: new Set(client.requireAnyOf),
      label: client.requireAnyOf.map((key) => `\`${key}\``).join(', '),
    }));
    if (clients.length === 0) {
      return {};
    }

    const check = (node: TSESTree.CallExpression | TSESTree.NewExpression): void => {
      const name = calleeText(node.callee);
      if (name === null) {
        return;
      }
      const construct = node.type === AST_NODE_TYPES.NewExpression;
      for (const client of clients) {
        if (client.callee !== name || client.construct !== construct) {
          continue;
        }
        if (lacksTimeout(node.arguments, client.keys)) {
          context.report({
            node: node.callee,
            messageId: 'missingTimeout',
            data: { callee: name, keys: client.label },
          });
        }
      }
    };

    return { CallExpression: check, NewExpression: check };
  },
});
