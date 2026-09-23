import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  constInitOf,
  matchesVocabulary,
  type SourceVocabulary,
  toVocabulary,
  unwrapExpression,
} from '../utils';

const RULE_NAME = 'no-timing-unsafe-compare';

export interface NoTimingUnsafeCompareOptions {
  /**
   * Expressions (source text) that hold a secret the rule cannot derive on its
   * own: `process.env.API_KEY`, `config.webhookSecret`. An entry ending in `()`
   * matches any call to that callee (`getApiKey()`). Default: none.
   */
  readonly secretSources?: readonly string[];
}

type RuleOptions = [NoTimingUnsafeCompareOptions];
type MessageIds = 'timingUnsafeCompare';

/*
 * Timing-attack precision. `===` on strings, and `Buffer#equals`, return at the
 * first differing byte, so how long a rejection takes says how much of a forged
 * signature was right. Against a webhook or signed-cookie check that is a byte-
 * by-byte forgery oracle. `crypto.timingSafeEqual` exists for exactly this.
 *
 * `eslint-plugin-security`'s `detect-possible-timing-attacks` guesses from names
 * (`password`, `token`, `secret`) and fires on `if (token === undefined)`, which
 * is why it is usually off. This rule decides by provenance instead. A value is
 * a secret only when the AST shows where it came from:
 *  - `.digest(...)` on a chain rooted at `createHmac(...)`, through `.update(...)`
 *    calls and `const` bindings (`const h = createHmac(...); h.update(b); h.digest()`);
 *  - the result of `crypto.subtle.sign(...)`;
 *  - an expression named in `secretSources`;
 *  - any of those through `Buffer.from(x)`, `new Uint8Array(x)`, `x.toString(...)`,
 *    `x.toLowerCase()` / `x.toUpperCase()`, and an in-file `const`.
 * A comparison is reported when exactly one side is a secret and the other is not
 * a static value. Deliberately left alone:
 *  - `createHash(...)` digests. An unkeyed hash is not a secret: ETags, cache
 *    keys, content addressing and integrity checks compare them all day, and
 *    learning a stored SHA-256 does not reveal what was hashed.
 *  - a secret against a literal, `undefined`, `null` or a static template:
 *    there is nothing forged to measure.
 *  - a secret against another secret, as in the double-HMAC pattern
 *    (`hmac(k, a) === hmac(k, b)`), a documented timing-attack mitigation.
 *  - `secret.length === other.length`: the length guard `timingSafeEqual` needs.
 * `timingSafeEqual` without a length guard is not checked: equal lengths often
 * hold by construction (both sides digested, a validated fixed-length header),
 * and the AST cannot see that.
 */

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(['===', '!==', '==', '!=']);
/** Methods that return the same secret in another encoding. */
const ENCODING_METHODS: ReadonlySet<string> = new Set(['toString', 'toLowerCase', 'toUpperCase']);
/** Constructors that wrap the same secret bytes. */
const BYTE_CONSTRUCTORS: ReadonlySet<string> = new Set(['Uint8Array', 'Buffer']);
const MAX_RESOLVE_DEPTH = 8;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    secretSources: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

interface SecretContext {
  readonly sources: SourceVocabulary;
  readonly sourceCode: Readonly<TSESLint.SourceCode>;
}

function memberName(node: TSESTree.Node): string | undefined {
  return node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
    ? node.property.name
    : undefined;
}

/** True when `raw` is an HMAC object: `createHmac(...)`, optionally fed through `.update(...)`. */
function isHmacChain(raw: TSESTree.Expression, ctx: SecretContext, depth: number): boolean {
  const node = unwrapExpression(raw);
  if (depth > MAX_RESOLVE_DEPTH) {
    return false;
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = constInitOf(node, ctx.sourceCode);
    return init !== undefined && isHmacChain(init, ctx, depth + 1);
  }
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const { callee } = node;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'createHmac';
  }
  const method = memberName(callee);
  if (method === 'createHmac') {
    return true;
  }
  return (
    method === 'update' &&
    callee.type === AST_NODE_TYPES.MemberExpression &&
    isHmacChain(callee.object, ctx, depth + 1)
  );
}

/** True when `raw` is `…subtle.sign(...)`, the Web Crypto signer. */
function isSubtleSign(node: TSESTree.CallExpression): boolean {
  const { callee } = node;
  if (memberName(callee) !== 'sign' || callee.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const receiver = callee.object;
  return (
    (receiver.type === AST_NODE_TYPES.Identifier && receiver.name === 'subtle') ||
    memberName(receiver) === 'subtle'
  );
}

/** True when the AST proves `raw` holds a secret: a MAC, a signature, or a configured source. */
function isSecret(raw: TSESTree.Expression, ctx: SecretContext, depth: number): boolean {
  const node = unwrapExpression(raw);
  if (matchesVocabulary(node, ctx.sources, ctx.sourceCode)) {
    return true;
  }
  if (depth > MAX_RESOLVE_DEPTH) {
    return false;
  }
  const secret = (child: TSESTree.CallExpressionArgument | undefined): boolean =>
    child !== undefined &&
    child.type !== AST_NODE_TYPES.SpreadElement &&
    isSecret(child, ctx, depth + 1);

  switch (node.type) {
    case AST_NODE_TYPES.Identifier: {
      const init = constInitOf(node, ctx.sourceCode);
      return init !== undefined && secret(init);
    }
    case AST_NODE_TYPES.NewExpression:
      return (
        node.callee.type === AST_NODE_TYPES.Identifier &&
        BYTE_CONSTRUCTORS.has(node.callee.name) &&
        secret(node.arguments[0])
      );
    case AST_NODE_TYPES.CallExpression: {
      const { callee } = node;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }
      const method = memberName(callee);
      if (method === 'digest') {
        return isHmacChain(callee.object, ctx, depth + 1);
      }
      if (method !== undefined && ENCODING_METHODS.has(method)) {
        return secret(callee.object);
      }
      if (
        method === 'from' &&
        callee.object.type === AST_NODE_TYPES.Identifier &&
        callee.object.name === 'Buffer'
      ) {
        return secret(node.arguments[0]);
      }
      return isSubtleSign(node);
    }
    default:
      return false;
  }
}

/** A value fixed at authoring time: there is no forged input on that side to time. */
function isStatic(raw: TSESTree.Expression): boolean {
  const node = unwrapExpression(raw);
  return (
    node.type === AST_NODE_TYPES.Literal ||
    (node.type === AST_NODE_TYPES.Identifier && node.name === 'undefined') ||
    (node.type === AST_NODE_TYPES.UnaryExpression && node.operator === 'void') ||
    (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0)
  );
}

export const noTimingUnsafeCompareRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'An HMAC digest or signature must not be compared with `===` / `!==` / `==` / `!=` or `Buffer#equals`; use `crypto.timingSafeEqual`.',
    },
    schema: [optionSchema],
    messages: {
      timingUnsafeCompare:
        '`{{operator}}` on a secret (an HMAC digest, a signature or a configured secret source) stops at the first differing byte, so response timing reveals how much of a forged value is correct. Compare equal-length buffers with `crypto.timingSafeEqual(a, b)` instead.',
    },
  },
  defaultOptions: [{ secretSources: [] }],
  create(context, [options]) {
    const ctx: SecretContext = {
      sources: toVocabulary(options.secretSources ?? []),
      sourceCode: context.sourceCode,
    };

    /** Reports when exactly one side is a secret and the other is a runtime value. */
    const check = (
      node: TSESTree.Node,
      left: TSESTree.Expression,
      right: TSESTree.Expression,
      operator: string,
    ): void => {
      const leftSecret = isSecret(left, ctx, 0);
      const rightSecret = isSecret(right, ctx, 0);
      if (leftSecret === rightSecret) {
        return;
      }
      if (isStatic(leftSecret ? right : left)) {
        return;
      }
      context.report({ node, messageId: 'timingUnsafeCompare', data: { operator } });
    };

    return {
      BinaryExpression(node: TSESTree.BinaryExpression): void {
        if (
          !COMPARISON_OPERATORS.has(node.operator) ||
          node.left.type === AST_NODE_TYPES.PrivateIdentifier
        ) {
          return;
        }
        check(node, node.left, node.right, node.operator);
      },

      CallExpression(node: TSESTree.CallExpression): void {
        const [other] = node.arguments;
        if (
          memberName(node.callee) !== 'equals' ||
          node.callee.type !== AST_NODE_TYPES.MemberExpression ||
          node.arguments.length !== 1 ||
          other === undefined ||
          other.type === AST_NODE_TYPES.SpreadElement ||
          node.callee.object.type === AST_NODE_TYPES.Super
        ) {
          return;
        }
        check(node, node.callee.object, other, '.equals()');
      },
    };
  },
});
