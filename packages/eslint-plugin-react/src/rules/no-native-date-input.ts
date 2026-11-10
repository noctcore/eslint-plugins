import { matchesAnyGlob } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-native-date-input';

export interface NoNativeDateInputOptions {
  readonly elementNames?: readonly string[];
  readonly types?: readonly string[];
  readonly replacement?: string;
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoNativeDateInputOptions];
type MessageIds = 'nativeDateInput';

/*
 * `<input type="date">` looks correct in every way a reviewer can check: it is
 * the semantic element, it is keyboard accessible, it validates, and it renders
 * perfectly for anyone whose browser UI is in the product's language. Chromium
 * takes a date input's display format from the browser's UI language and
 * ignores both the element's `lang` and the page locale, so a product served
 * with `<html lang="pl">` still shows `03/04/2026` in a Chrome installed in
 * English, and 3 April cannot be told from 4 March. `datetime-local`, `month`
 * and `week` render in the browser's language for the same reason.
 *
 * This is a house convention (use the design system's picker), not a bug in
 * every codebase, so the rule ships opt-in. It is syntactic on purpose: it
 * matches the configured element names with a literal `type`. A wrapper that
 * forwards `type={someVariable}` is out of reach; branch on the date case
 * before the input is rendered. `allowIn` exempts the picker's own file.
 */
const DEFAULT_ELEMENT_NAMES: readonly string[] = ['input', 'Input'];

const DEFAULT_TYPES: readonly string[] = ['date', 'datetime-local', 'month', 'week'];

const DEFAULT_REPLACEMENT = "the design system's date picker";

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    elementNames: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: 'JSX element names that render a native `<input>`. Default `input` and `Input`.',
    },
    types: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        '`type` values whose native rendering follows the browser language. Default `date`, `datetime-local`, `month`, `week`.',
    },
    replacement: {
      type: 'string',
      description: 'What the message tells people to use instead, such as a component name or import path.',
    },
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: 'File-path globs where a native date input is allowed, such as the picker component itself.',
    },
  },
};

/** The element's tag name, or null for a member expression like `Form.Input`. */
function elementName(node: TSESTree.JSXOpeningElement): string | null {
  return node.name.type === AST_NODE_TYPES.JSXIdentifier ? node.name.name : null;
}

/** The literal value of a `type` attribute, braced or not. */
function literalTypeValue(attribute: TSESTree.JSXAttribute): string | null {
  const value = attribute.value;
  if (value === null) {
    return null;
  }
  if (value.type === AST_NODE_TYPES.Literal) {
    return typeof value.value === 'string' ? value.value : null;
  }
  if (
    value.type === AST_NODE_TYPES.JSXExpressionContainer &&
    value.expression.type === AST_NODE_TYPES.Literal &&
    typeof value.expression.value === 'string'
  ) {
    return value.expression.value;
  }
  return null;
}

export const noNativeDateInputRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow native date inputs (`type="date"` and friends): Chromium formats them in the browser UI language and ignores `lang`, so the date order can contradict the page.',
    },
    schema: [optionSchema],
    messages: {
      nativeDateInput:
        'Native `type="{{type}}"` input. Chromium formats it from the browser\'s UI language and ignores `lang`, so the day and month order can contradict the rest of the page. Use {{replacement}} instead.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (matchesAnyGlob(context.filename, options.allowIn ?? [])) {
      return {};
    }
    const elementNames = new Set(options.elementNames ?? DEFAULT_ELEMENT_NAMES);
    const types = new Set(options.types ?? DEFAULT_TYPES);
    const replacement = options.replacement ?? DEFAULT_REPLACEMENT;

    return {
      JSXOpeningElement(node): void {
        const name = elementName(node);
        if (name === null || !elementNames.has(name)) {
          return;
        }
        for (const attribute of node.attributes) {
          if (
            attribute.type !== AST_NODE_TYPES.JSXAttribute ||
            attribute.name.type !== AST_NODE_TYPES.JSXIdentifier ||
            attribute.name.name !== 'type'
          ) {
            continue;
          }
          const value = literalTypeValue(attribute);
          if (value === null || !types.has(value)) {
            continue;
          }
          context.report({
            node: attribute,
            messageId: 'nativeDateInput',
            data: { type: value, replacement },
          });
        }
      },
    };
  },
});
