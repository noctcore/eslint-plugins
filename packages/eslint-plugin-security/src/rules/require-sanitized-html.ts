import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  constInitOf,
  matchesVocabulary,
  type SourceVocabulary,
  squash,
  toVocabulary,
  unwrapExpression,
} from '../utils';

const RULE_NAME = 'require-sanitized-html';

export interface RequireSanitizedHtmlOptions {
  /**
   * Functions (callee source text) whose result is sanitized HTML. Replaces the
   * defaults when set, so `[]` accepts no sanitizer at all.
   */
  readonly sanitizers?: readonly string[];
  /**
   * Expressions (source text) that hold trusted HTML the rule cannot see into:
   * a syntax highlighter's output, compiled Markdown. An entry ending in `()`
   * matches any call to that callee.
   */
  readonly trustedSources?: readonly string[];
}

type RuleOptions = [RequireSanitizedHtmlOptions];
type MessageIds = 'unsanitizedHtml';

/*
 * XSS precision. React escapes everything it renders except the one prop named
 * for the danger, and the DOM parses whatever is assigned to `innerHTML`. Both
 * are where a stored or reflected string becomes script. `react/no-danger` bans
 * the prop outright, so teams that need it turn that rule off and lose the
 * check entirely; `eslint-plugin-no-unsanitized` covers the DOM sinks but not
 * React. This rule allows the sink and asks for proof instead.
 *
 * An HTML value passes when the rule can SEE that it is safe:
 *  - author-written markup: a literal, a template or `+` whose every part passes,
 *    a `?:` / `||` / `??` whose branches both pass, `cond && X` when `X` passes;
 *  - a `const` declared in this file whose initializer passes;
 *  - a call to a configured sanitizer (`DOMPurify.sanitize(dirty)`), or an
 *    expression named in `trustedSources`.
 * Everything else is reported, because nothing else is proof. Sinks:
 *  - JSX `dangerouslySetInnerHTML={{ __html: X }}` (and a `const` object literal
 *    passed as the prop value);
 *  - `el.innerHTML = X`, `el.outerHTML = X` and their `+=` forms;
 *  - `el.insertAdjacentHTML(position, X)`.
 * There is no autofix: which sanitizer, and with which config, is the author's call.
 */

/**
 * The default sanitizer vocabulary: DOMPurify (and `isomorphic-dompurify`,
 * whose named export is `sanitize`), `sanitize-html` under its documented import
 * name, and `xss` / `filterXSS` from js-xss.
 */
export const DEFAULT_SANITIZERS: readonly string[] = [
  'DOMPurify.sanitize',
  'sanitize',
  'sanitizeHtml',
  'xss',
  'filterXSS',
];

const HTML_PROPERTIES: ReadonlySet<string> = new Set(['innerHTML', 'outerHTML']);
const MAX_RESOLVE_DEPTH = 8;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sanitizers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    trustedSources: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

interface HtmlTrust {
  readonly sanitizers: ReadonlySet<string>;
  readonly trusted: SourceVocabulary;
  readonly sourceCode: Readonly<TSESLint.SourceCode>;
}

/** True when the rule can prove `raw` evaluates to author-written or sanitized HTML. */
function isSafeHtml(raw: TSESTree.Expression, trust: HtmlTrust, depth: number): boolean {
  const node = unwrapExpression(raw);
  if (isTrusted(node, trust)) {
    return true;
  }
  if (depth > MAX_RESOLVE_DEPTH) {
    return false;
  }
  const safe = (child: TSESTree.Expression): boolean => isSafeHtml(child, trust, depth + 1);

  switch (node.type) {
    case AST_NODE_TYPES.Literal:
      return true;
    case AST_NODE_TYPES.TemplateLiteral:
      return node.expressions.every(safe);
    case AST_NODE_TYPES.BinaryExpression:
      return node.operator === '+' && safe(node.left) && safe(node.right);
    case AST_NODE_TYPES.ConditionalExpression:
      return safe(node.consequent) && safe(node.alternate);
    case AST_NODE_TYPES.LogicalExpression:
      // `a && b` only yields `a` when it is falsy, and no falsy value is markup.
      return (node.operator === '&&' || safe(node.left)) && safe(node.right);
    case AST_NODE_TYPES.Identifier: {
      if (node.name === 'undefined') {
        return true;
      }
      const init = constInitOf(node, trust.sourceCode);
      return init !== undefined && safe(init);
    }
    default:
      return false;
  }
}

function isTrusted(node: TSESTree.Expression, trust: HtmlTrust): boolean {
  return (
    matchesVocabulary(node, trust.trusted, trust.sourceCode) ||
    (node.type === AST_NODE_TYPES.CallExpression &&
      trust.sanitizers.has(squash(trust.sourceCode.getText(node.callee))))
  );
}

/** The `__html` value of a `{ __html: X }` literal; `null` when the object hides it behind a spread. */
function htmlPropertyOf(object: TSESTree.ObjectExpression): TSESTree.Expression | null | undefined {
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      return null;
    }
    if (
      !property.computed &&
      ((property.key.type === AST_NODE_TYPES.Identifier && property.key.name === '__html') ||
        (property.key.type === AST_NODE_TYPES.Literal && property.key.value === '__html'))
    ) {
      return property.value.type === AST_NODE_TYPES.AssignmentPattern ||
        property.value.type === AST_NODE_TYPES.ArrayPattern ||
        property.value.type === AST_NODE_TYPES.ObjectPattern ||
        property.value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression
        ? null
        : property.value;
    }
  }
  return undefined;
}

/** A `{ __html }` object literal, seen directly or through an in-file `const`. */
function markupObjectOf(
  raw: TSESTree.Expression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.ObjectExpression | undefined {
  const node = unwrapExpression(raw);
  if (node.type === AST_NODE_TYPES.ObjectExpression) {
    return node;
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = constInitOf(node, sourceCode);
    const unwrapped = init === undefined ? undefined : unwrapExpression(init);
    return unwrapped?.type === AST_NODE_TYPES.ObjectExpression ? unwrapped : undefined;
  }
  return undefined;
}

function propertyName(node: TSESTree.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
    return node.property.name;
  }
  if (node.computed && node.property.type === AST_NODE_TYPES.Literal) {
    return typeof node.property.value === 'string' ? node.property.value : undefined;
  }
  return undefined;
}

export const requireSanitizedHtmlRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'HTML reaching `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` or `insertAdjacentHTML` must be static markup or pass through a configured sanitizer.',
    },
    schema: [optionSchema],
    messages: {
      unsanitizedHtml:
        'The HTML passed to `{{sink}}` is neither author-written markup nor the result of a sanitizer, so a stored or reflected string can run as script (XSS). Wrap it in a sanitizer such as `DOMPurify.sanitize(...)`, or name the function that produces trusted HTML in `sanitizers` or `trustedSources`.',
    },
  },
  defaultOptions: [{ sanitizers: DEFAULT_SANITIZERS, trustedSources: [] }],
  create(context, [options]) {
    const sourceCode = context.sourceCode;
    const trust: HtmlTrust = {
      // A sanitizer is always a callee, written with or without a trailing `()`.
      sanitizers: new Set(
        (options.sanitizers ?? DEFAULT_SANITIZERS).map((entry) => squash(entry).replace(/\(\)$/u, '')),
      ),
      trusted: toVocabulary(options.trustedSources ?? []),
      sourceCode,
    };

    const check = (value: TSESTree.Expression, sink: string): void => {
      if (!isSafeHtml(value, trust, 0)) {
        context.report({ node: value, messageId: 'unsanitizedHtml', data: { sink } });
      }
    };

    return {
      JSXAttribute(node: TSESTree.JSXAttribute): void {
        if (
          node.name.type !== AST_NODE_TYPES.JSXIdentifier ||
          node.name.name !== 'dangerouslySetInnerHTML' ||
          node.value?.type !== AST_NODE_TYPES.JSXExpressionContainer ||
          node.value.expression.type === AST_NODE_TYPES.JSXEmptyExpression
        ) {
          return;
        }
        const value = node.value.expression;
        const object = markupObjectOf(value, sourceCode);
        if (object === undefined) {
          // A markup object built elsewhere: only a trusted source vouches for it.
          if (!isTrusted(unwrapExpression(value), trust)) {
            context.report({
              node: value,
              messageId: 'unsanitizedHtml',
              data: { sink: 'dangerouslySetInnerHTML' },
            });
          }
          return;
        }
        const html = htmlPropertyOf(object);
        if (html === null) {
          context.report({
            node: object,
            messageId: 'unsanitizedHtml',
            data: { sink: 'dangerouslySetInnerHTML' },
          });
        } else if (html !== undefined) {
          check(html, 'dangerouslySetInnerHTML');
        }
      },

      AssignmentExpression(node: TSESTree.AssignmentExpression): void {
        if (
          (node.operator !== '=' && node.operator !== '+=') ||
          node.left.type !== AST_NODE_TYPES.MemberExpression
        ) {
          return;
        }
        const name = propertyName(node.left);
        if (name !== undefined && HTML_PROPERTIES.has(name)) {
          check(node.right, name);
        }
      },

      CallExpression(node: TSESTree.CallExpression): void {
        if (
          node.callee.type !== AST_NODE_TYPES.MemberExpression ||
          propertyName(node.callee) !== 'insertAdjacentHTML'
        ) {
          return;
        }
        const html = node.arguments[1];
        if (html !== undefined && html.type !== AST_NODE_TYPES.SpreadElement) {
          check(html, 'insertAdjacentHTML');
        }
      },
    };
  },
});
