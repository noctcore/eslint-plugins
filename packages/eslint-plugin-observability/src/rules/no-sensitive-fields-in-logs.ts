import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { DEFAULT_LOGGERS, loggerCallMethod } from '../utils';

const RULE_NAME = 'no-sensitive-fields-in-logs';

export interface NoSensitiveFieldsInLogsOptions {
  readonly denyNames?: readonly string[];
}

type RuleOptions = [NoSensitiveFieldsInLogsOptions];
type MessageIds = 'sensitiveField';

/*
 * A name-heuristic tripwire for secrets in logs. Any identifier, member-access,
 * or object-property NAME inside a logger call that matches the denylist
 * (`password`, `token`, `secret`, ...) is very likely leaking a credential into
 * a log sink. This is a HEURISTIC — it reads names, never values — so it ships at
 * `warn`, not `error`.
 *
 * Matching is name-segment aware to keep the signal: a single-word denyName
 * (`token`) matches a camelCase / snake_case SEGMENT (`accessToken`,
 * `access_token`) but not a longer word that merely contains it (`tokenize`,
 * `tokenizer`). A multi-word denyName (`apiKey`) matches on the compacted name
 * (`myApiKey` → `myapikey` contains `apikey`). String LITERAL arguments are never
 * inspected — only names — so `log.info('password reset sent')` is fine.
 */
const DEFAULT_DENY_NAMES: readonly string[] = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apiKey',
  'ssn',
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    denyNames: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

/** Lowercased camelCase / snake_case / kebab segments of a name. */
function nameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Name with all non-alphanumerics stripped, lowercased (`api_key` → `apikey`). */
function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Build a matcher closure from the configured denylist. */
function makeMatcher(denyNames: readonly string[]): (name: string) => boolean {
  const single: string[] = [];
  const multi: string[] = [];
  for (const deny of denyNames) {
    const segs = nameSegments(deny);
    if (segs.length <= 1) {
      single.push(compact(deny));
    } else {
      multi.push(compact(deny));
    }
  }
  return (name: string): boolean => {
    const segs = new Set(nameSegments(name));
    if (single.some((deny) => segs.has(deny))) {
      return true;
    }
    const flat = compact(name);
    return multi.some((deny) => flat.includes(deny));
  };
}

export const noSensitiveFieldsInLogsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A logger call must not reference an identifier, property, or object key whose name matches a sensitive-field denylist (password, token, secret, ...). Redact it before logging.',
    },
    schema: [optionSchema],
    messages: {
      sensitiveField:
        "`{{name}}` looks like a sensitive field being written to a log sink. Redact it before logging (e.g. `redact({{name}})`) or omit it — logs are long-lived and widely readable.",
    },
  },
  defaultOptions: [{ denyNames: DEFAULT_DENY_NAMES }],
  create(context, [options]) {
    const matches = makeMatcher(options.denyNames ?? DEFAULT_DENY_NAMES);

    /** Generic descent over an argument subtree, skipping the `parent` back-edge. */
    function walk(node: TSESTree.Node, visit: (n: TSESTree.Node) => void): void {
      visit(node);
      for (const key of Object.keys(node)) {
        if (key === 'parent') {
          continue;
        }
        const value = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof (child as { type?: unknown }).type === 'string') {
              walk(child as TSESTree.Node, visit);
            }
          }
        } else if (value && typeof (value as { type?: unknown }).type === 'string') {
          walk(value as TSESTree.Node, visit);
        }
      }
    }

    return {
      CallExpression(node): void {
        if (loggerCallMethod(node, new Set(DEFAULT_LOGGERS)) === null) {
          // Logger detection here uses the default logger set — this rule keys off
          // WHAT is logged, not which sink; the sink names are fixed.
          return;
        }
        const reported = new Set<number>();
        const report = (name: string, target: TSESTree.Node): void => {
          const at = target.range[0];
          if (reported.has(at)) {
            return;
          }
          reported.add(at);
          context.report({
            node: target,
            messageId: 'sensitiveField',
            data: { name },
          });
        };

        for (const arg of node.arguments) {
          walk(arg, (n) => {
            if (n.type === AST_NODE_TYPES.Identifier && matches(n.name)) {
              report(n.name, n);
            } else if (
              n.type === AST_NODE_TYPES.Property &&
              n.key.type === AST_NODE_TYPES.Literal &&
              typeof n.key.value === 'string' &&
              matches(n.key.value)
            ) {
              report(n.key.value, n.key);
            }
          });
        }
      },
    };
  },
});
