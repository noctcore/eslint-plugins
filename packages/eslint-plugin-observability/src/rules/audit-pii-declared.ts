import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { compactName, makeNameMatcher, nameSegments } from '../utils';

const RULE_NAME = 'audit-pii-declared';

export interface AuditPiiDeclaredOptions {
  readonly auditCallees?: readonly string[];
  readonly payloadKeys?: readonly string[];
  readonly piiFields?: readonly string[];
  readonly registeredFields?: readonly string[];
  readonly nonPiiFields?: readonly string[];
  readonly nonPiiPrefixes?: readonly string[];
  readonly nonPiiSuffixes?: readonly string[];
  readonly reportOpaque?: boolean;
}

type RuleOptions = [AuditPiiDeclaredOptions];
type MessageIds = 'undeclaredPiiKey' | 'undeclaredPiiValue' | 'opaquePayload';

/*
 * Audit rows outlive the request that wrote them. When a policy says personal
 * data in audit payloads is scrubbed when its subject is purged, the purger
 * needs a list of the payload keys to scrub. A lint rule cannot see the purger,
 * and it cannot prove the purger runs. What it CAN enforce is the other half of
 * the contract: every PII-shaped key an audit write puts into its payload is
 * DECLARED, either as registered (the purger scrubs it) or as not personal data.
 *
 * An audit write is a call whose callee text is one of `auditCallees` (or ends
 * with `.<entry>`, so `this.auditService.log` matches `auditService.log`). Its
 * first argument's `payloadKeys` properties (`metadata`, `before`, `after`) are
 * the payload. Inside a payload object literal, at any depth:
 *   - a key whose name matches `piiFields` must be in `registeredFields` or
 *     `nonPiiFields`;
 *   - an undeclared key whose VALUE is an identifier or member access named like
 *     PII (`target: user.email`) is reported too, since the key is what the
 *     purger would have to scrub.
 * A payload it cannot read (a non-literal payload, a spread, a computed key) is
 * reported as opaque unless `reportOpaque` is false: a bag the rule cannot see
 * is a bag it cannot vouch for.
 *
 * The rule ships inert: `auditCallees` defaults to empty.
 */
const DEFAULT_PAYLOAD_KEYS: readonly string[] = ['metadata', 'before', 'after'];

const DEFAULT_PII_FIELDS: readonly string[] = [
  'email',
  'phone',
  'mobile',
  'address',
  'firstName',
  'lastName',
  'fullName',
  'displayName',
  'surname',
  'birthDate',
  'dateOfBirth',
];

/*
 * A PII-shaped name whose first segment is a boolean prefix (`isEmailPublic`) or
 * whose last segment is one of these (`emailSent`, `phoneVerified`, `addressId`)
 * names a flag, a count or a reference ABOUT the data, not the data itself.
 */
const DEFAULT_NON_PII_PREFIXES: readonly string[] = ['is', 'has', 'was', 'should', 'can'];

const DEFAULT_NON_PII_SUFFIXES: readonly string[] = [
  'sent',
  'verified',
  'confirmed',
  'enabled',
  'disabled',
  'changed',
  'required',
  'count',
  'type',
  'kind',
  'status',
  'id',
  'ids',
];

const stringList: JSONSchema4 = { type: 'array', items: { type: 'string' }, uniqueItems: true };

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    auditCallees: { ...stringList, default: [] },
    payloadKeys: { ...stringList, default: [...DEFAULT_PAYLOAD_KEYS] },
    piiFields: { ...stringList, default: [...DEFAULT_PII_FIELDS] },
    registeredFields: { ...stringList, default: [] },
    nonPiiFields: { ...stringList, default: [] },
    nonPiiPrefixes: { ...stringList, default: [...DEFAULT_NON_PII_PREFIXES] },
    nonPiiSuffixes: { ...stringList, default: [...DEFAULT_NON_PII_SUFFIXES] },
    reportOpaque: { type: 'boolean', default: true },
  },
};

/**
 * Dotted text of a callee made of identifiers, `this` and non-computed member
 * accesses (`this.auditService.log`). Null for any other shape.
 */
function calleeText(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (node.type === AST_NODE_TYPES.ThisExpression) {
    return 'this';
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    const object = calleeText(node.object);
    return object === null ? null : `${object}.${node.property.name}`;
  }
  return null;
}

/** A property's static key name, or null for a computed / non-string key. */
function staticKeyName(property: TSESTree.Property): string | null {
  if (property.computed) {
    return null;
  }
  const key = property.key;
  if (key.type === AST_NODE_TYPES.Identifier) {
    return key.name;
  }
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string') {
    return key.value;
  }
  return null;
}

/** The trailing name of an identifier or member access (`user.email` → `email`). */
function valueName(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    return node.property.name;
  }
  if (node.type === AST_NODE_TYPES.ChainExpression) {
    return valueName(node.expression);
  }
  if (
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSAsExpression
  ) {
    return valueName(node.expression);
  }
  return null;
}

/** A literal the payload slot may hold without being an opaque bag. */
function isEmptyValue(node: TSESTree.Node): boolean {
  return (
    (node.type === AST_NODE_TYPES.Literal && node.value === null) ||
    (node.type === AST_NODE_TYPES.Identifier && node.name === 'undefined')
  );
}

/** A boolean, number or null literal: whatever its key, it holds no personal data. */
function isScalarFlag(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.Literal &&
    (typeof node.value === 'boolean' || typeof node.value === 'number' || node.value === null)
  );
}

/**
 * The object literals a spread argument can contribute: the literal itself, both
 * branches of a conditional (`...(ok ? { a } : {})`), the right side of `&&`, or
 * nothing for `null` / `undefined`. Null when any branch is not a literal.
 */
function spreadSources(node: TSESTree.Node): TSESTree.ObjectExpression[] | null {
  if (node.type === AST_NODE_TYPES.ObjectExpression) {
    return [node];
  }
  if (isEmptyValue(node)) {
    return [];
  }
  if (node.type === AST_NODE_TYPES.ConditionalExpression) {
    const consequent = spreadSources(node.consequent);
    const alternate = spreadSources(node.alternate);
    return consequent === null || alternate === null ? null : [...consequent, ...alternate];
  }
  if (node.type === AST_NODE_TYPES.LogicalExpression && node.operator === '&&') {
    return spreadSources(node.right);
  }
  return null;
}

export const auditPiiDeclaredRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A PII-shaped key written into an audit payload must be declared, either registered for scrubbing on purge or declared non-PII.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      undeclaredPiiKey:
        '`{{key}}` looks like personal data in audit `{{payload}}`. Add it to `registeredFields` (the keys your purger scrubs) or, if it is not personal data, to `nonPiiFields`.',
      undeclaredPiiValue:
        '`{{key}}` in audit `{{payload}}` holds `{{value}}`, which looks like personal data. Add `{{key}}` to `registeredFields` (the keys your purger scrubs) or, if it is not personal data, to `nonPiiFields`.',
      opaquePayload:
        'Audit `{{payload}}` cannot be read statically ({{why}}), so its keys cannot be checked against the PII registry. Write it as an object literal.',
    },
  },
  defaultOptions: [
    {
      auditCallees: [],
      payloadKeys: DEFAULT_PAYLOAD_KEYS,
      piiFields: DEFAULT_PII_FIELDS,
      registeredFields: [],
      nonPiiFields: [],
      nonPiiPrefixes: DEFAULT_NON_PII_PREFIXES,
      nonPiiSuffixes: DEFAULT_NON_PII_SUFFIXES,
      reportOpaque: true,
    },
  ],
  create(context, [options]) {
    const auditCallees = options.auditCallees ?? [];
    if (auditCallees.length === 0) {
      return {};
    }
    const payloadKeys = new Set(options.payloadKeys ?? DEFAULT_PAYLOAD_KEYS);
    const looksLikePii = makeNameMatcher(options.piiFields ?? DEFAULT_PII_FIELDS);
    const declared = new Set([
      ...(options.registeredFields ?? []),
      ...(options.nonPiiFields ?? []),
    ]);
    const reportOpaque = options.reportOpaque ?? true;
    const nonPiiPrefixes = new Set(options.nonPiiPrefixes ?? DEFAULT_NON_PII_PREFIXES);
    const nonPiiSuffixes = new Set(options.nonPiiSuffixes ?? DEFAULT_NON_PII_SUFFIXES);

    /** PII-shaped and not a flag, count or reference about PII. */
    const exactPii = new Set(
      (options.piiFields ?? DEFAULT_PII_FIELDS).map((field) => compactName(field)),
    );
    const isPiiName = (name: string): boolean => {
      if (!looksLikePii(name)) {
        return false;
      }
      // Naming a field in piiFields exactly (`nationalId`) beats the suffix heuristic.
      if (exactPii.has(compactName(name))) {
        return true;
      }
      const segments = nameSegments(name);
      const first = segments[0];
      const last = segments[segments.length - 1];
      const isAbout =
        segments.length > 1 &&
        ((first !== undefined && nonPiiPrefixes.has(first)) ||
          (last !== undefined && nonPiiSuffixes.has(last)));
      return !isAbout;
    };

    const isAuditCall = (callee: TSESTree.Node): boolean => {
      const text = calleeText(callee);
      return (
        text !== null && auditCallees.some((entry) => text === entry || text.endsWith(`.${entry}`))
      );
    };

    const opaque = (node: TSESTree.Node, payload: string, why: string): void => {
      if (reportOpaque) {
        context.report({ node, messageId: 'opaquePayload', data: { payload, why } });
      }
    };

    /** Check one payload object literal, recursing into nested literals and spreads. */
    const checkObject = (object: TSESTree.ObjectExpression, payload: string): void => {
      for (const property of object.properties) {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          const sources = spreadSources(property.argument);
          if (sources === null) {
            opaque(property, payload, 'it spreads a value that is not an object literal');
          } else {
            sources.forEach((source) => checkObject(source, payload));
          }
          continue;
        }
        const key = staticKeyName(property);
        if (key === null) {
          opaque(property.key, payload, 'it has a computed key');
          continue;
        }
        const value = property.value;
        if (!declared.has(key) && !isScalarFlag(value)) {
          if (isPiiName(key)) {
            context.report({
              node: property.key,
              messageId: 'undeclaredPiiKey',
              data: { key, payload },
            });
          } else {
            const name = valueName(value);
            if (name !== null && isPiiName(name)) {
              context.report({
                node: property.key,
                messageId: 'undeclaredPiiValue',
                data: { key, payload, value: context.sourceCode.getText(value) },
              });
            }
          }
        }
        checkNested(value, payload);
      }
    };

    const checkNested = (node: TSESTree.Node, payload: string): void => {
      if (node.type === AST_NODE_TYPES.ObjectExpression) {
        checkObject(node, payload);
      } else if (node.type === AST_NODE_TYPES.ArrayExpression) {
        for (const element of node.elements) {
          if (element !== null && element.type !== AST_NODE_TYPES.SpreadElement) {
            checkNested(element, payload);
          }
        }
      }
    };

    /** Find the payload properties of the audit call's params literal. */
    const checkParams = (params: TSESTree.ObjectExpression): void => {
      for (const property of params.properties) {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          const sources = spreadSources(property.argument);
          if (sources === null) {
            opaque(property, 'params', 'it spreads a value that is not an object literal');
          } else {
            sources.forEach(checkParams);
          }
          continue;
        }
        const key = staticKeyName(property);
        if (key === null || !payloadKeys.has(key)) {
          continue;
        }
        const value = property.value;
        if (value.type === AST_NODE_TYPES.ObjectExpression) {
          checkObject(value, key);
        } else if (!isEmptyValue(value)) {
          opaque(value, key, 'it is not an object literal');
        }
      }
    };

    return {
      CallExpression(node): void {
        if (!isAuditCall(node.callee)) {
          return;
        }
        const [params] = node.arguments;
        if (params === undefined) {
          return;
        }
        if (params.type !== AST_NODE_TYPES.ObjectExpression) {
          opaque(params, 'params', 'the audit call is not given an object literal');
          return;
        }
        checkParams(params);
      },
    };
  },
});
