import { AST_NODE_TYPES, calleeName, isNode, type TSESTree } from '@noctcore/eslint-utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  DEFAULT_LOG_METHODS,
  DEFAULT_LOGGERS,
  type LoggerCallOptions,
  loggerCallMatcher,
  loggerCallMethod,
  loggerCallOptionProperties,
  makeNameMatcher,
  nameSegments,
} from '../utils';

const RULE_NAME = 'no-sensitive-fields-in-logs';

export interface NoSensitiveFieldsInLogsOptions extends LoggerCallOptions {
  readonly denyNames?: readonly string[];
  readonly redactors?: readonly string[];
  readonly allowNames?: readonly string[];
}

type RuleOptions = [NoSensitiveFieldsInLogsOptions];
type MessageIds = 'sensitiveField';

/*
 * A name-heuristic tripwire for secrets in logs. Any identifier, member-access,
 * or object-property NAME inside a logger call that matches the denylist
 * (`password`, `token`, `secret`, ...) is very likely leaking a credential into
 * a log sink. This is a HEURISTIC (it reads names, never values), but a miss
 * costs far more than a false positive, so it ships at `error`.
 *
 * Matching is name-segment aware to keep the signal: a single-word denyName
 * (`token`) matches a camelCase / snake_case SEGMENT (`accessToken`,
 * `access_token`) but not a longer word that merely contains it (`tokenize`,
 * `tokenizer`). A multi-word denyName (`apiKey`) matches on the compacted name
 * (`myApiKey` → `myapikey` contains `apikey`). String LITERAL arguments are never
 * inspected — only names — so `log.info('password reset sent')` is fine.
 *
 * A call to a redactor (`redact(token)`, `mask(user.password)`, configurable via
 * `redactors`) is a boundary: the walk does not enter it, and an object key whose
 * value is a redactor call is not reported. Names that read as a flag, a count or
 * a timestamp about the secret rather than the secret itself are exempt
 * (`hasPassword`, `isTokenValid`, `tokenCount`, `passwordLength`,
 * `tokenExpiresAt`, `cookieConsent`).
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

const DEFAULT_REDACTORS: readonly string[] = ['redact', 'mask'];

/** A leading segment that makes a name a flag about the field (`hasPassword`). */
const FLAG_PREFIXES: ReadonlySet<string> = new Set([
  'is',
  'has',
  'should',
  'can',
  'did',
  'was',
  'needs',
  'show',
]);

/** A trailing segment that makes a name metadata about the field (`tokenCount`). */
const METADATA_SUFFIXES: ReadonlySet<string> = new Set([
  'count',
  'length',
  'size',
  'ttl',
  'at',
  'in',
  'expires',
  'expiry',
  'consent',
  'enabled',
  'required',
]);

/** True when a name reads as a flag, count or timestamp rather than the value. */
function isMetadataName(name: string): boolean {
  const segs = nameSegments(name);
  if (segs.length < 2) {
    return false;
  }
  return FLAG_PREFIXES.has(segs[0] ?? '') || METADATA_SUFFIXES.has(segs[segs.length - 1] ?? '');
}

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    denyNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Field names to treat as sensitive (case-insensitive, segment-aware); replaces the default denylist.',
    },
    redactors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Function names whose call output is safe to log; the walk does not enter their arguments.',
    },
    allowNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exact names never reported, even when they match the denylist.',
    },
    ...loggerCallOptionProperties,
  },
};

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
        '`{{name}}` looks like a sensitive field being written to a log sink. Pass it through a redactor (e.g. `redact({{name}})`) or omit it, because logs are long-lived and widely readable.',
    },
  },
  defaultOptions: [
    {
      denyNames: DEFAULT_DENY_NAMES,
      redactors: DEFAULT_REDACTORS,
      allowNames: [],
      loggers: DEFAULT_LOGGERS,
      methods: DEFAULT_LOG_METHODS,
    },
  ],
  create(context, [options]) {
    const denied = makeNameMatcher(options.denyNames ?? DEFAULT_DENY_NAMES);
    const redactors = new Set(options.redactors ?? DEFAULT_REDACTORS);
    const allowNames = new Set(options.allowNames ?? []);
    const matcher = loggerCallMatcher(options);

    const matches = (name: string): boolean =>
      !allowNames.has(name) && !isMetadataName(name) && denied(name);

    const isRedactorCall = (node: TSESTree.Node): boolean => {
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return false;
      }
      const name = calleeName(node.callee);
      return name !== null && redactors.has(name);
    };

    const keys = context.sourceCode.visitorKeys;

    /**
     * Descent over an argument subtree along the parser's visitor keys, pruning
     * redactor calls and any object property whose value is a redactor call.
     */
    function walk(node: TSESTree.Node, visit: (n: TSESTree.Node) => void): void {
      if (isRedactorCall(node)) {
        return;
      }
      if (node.type === AST_NODE_TYPES.Property && isRedactorCall(node.value)) {
        return;
      }
      visit(node);
      for (const key of keys[node.type] ?? []) {
        const value: unknown = Reflect.get(node, key);
        if (Array.isArray(value)) {
          for (const child of value) {
            if (isNode(child)) {
              walk(child, visit);
            }
          }
        } else if (isNode(value)) {
          walk(value, visit);
        }
      }
    }

    return {
      CallExpression(node): void {
        if (loggerCallMethod(node, matcher) === null) {
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
