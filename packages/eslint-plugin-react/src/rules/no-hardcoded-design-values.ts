import { fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  CATEGORY_LABELS,
  checkClassToken,
  checkCssValue,
  cssDeclarations,
  DESIGN_CATEGORIES,
  type DesignCategory,
  type DesignFinding,
  type DesignPolicy,
  propertyCategory,
} from '../design-values';

const RULE_NAME = 'no-hardcoded-design-values';

export interface NoHardcodedDesignValuesOptions {
  readonly categories?: readonly DesignCategory[];
  readonly allowedVarPrefixes?: readonly string[];
  readonly allowedVars?: readonly string[];
  readonly allowedValues?: readonly string[];
  readonly fontNames?: readonly string[];
  readonly classAttributes?: readonly string[];
  readonly classFunctions?: readonly string[];
  readonly styleAttributes?: readonly string[];
  readonly checkStyleObjects?: boolean;
  readonly cssTags?: readonly string[];
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoHardcodedDesignValuesOptions];
type MessageIds = 'paletteClass' | 'fontNameClass' | 'hardcodedClass' | 'hardcodedStyle' | 'disallowedVar';

/*
 * A design system lets a theme restyle every component by swapping tokens. A
 * component that writes `bg-blue-500`, `rounded-[6px]` or
 * `style={{ color: '#1e40af' }}` opts out: the theme changes, that component
 * does not, and nobody notices until a customer's dark mode ships with one
 * bright blue button.
 *
 * Checked, and nothing else:
 *   - class strings: the `classAttributes` of a JSX element (`className`,
 *     `class`), and every string in a call to one of `classFunctions` (`cn`,
 *     `clsx`, `cva`, ...), object keys and nested arrays included;
 *   - inline style objects: the `styleAttributes` of a JSX element (`style`);
 *   - CSS-in-JS templates: a tagged template whose tag starts with one of
 *     `cssTags` (`styled.div`, `styled(Button)`, `css`, `keyframes`).
 *
 * A class token is reported when it is a Tailwind palette utility
 * (`text-zinc-900`, `bg-white`) or an arbitrary value that hardcodes a design
 * value (`rounded-[6px]`, `text-[#fff]`, `duration-[200ms]`, `p-[13px]`,
 * `font-['Inter']`). Theme-scale utilities (`bg-primary`, `p-4`,
 * `rounded-md`) and arbitrary values for geometry (`w-[200px]`,
 * `grid-cols-[1fr_2fr]`) are never reported. A style or CSS declaration is
 * reported when its property belongs to a category and its literal value
 * hardcodes one: a raw colour, a non-zero length, a duration, a curve, a font
 * name. Values the rule cannot read (a variable, a call, an interpolation) are
 * left alone, so only literals are judged.
 *
 * CSS variables are tokens. With `allowedVarPrefixes` set, only variables with
 * one of those prefixes, or named in `allowedVars` (runtime geometry a headless
 * library measures), are; any other `var(--x)` is reported.
 *
 * Tests and stories are skipped by default (`allowIn`).
 */
const DEFAULT_CLASS_ATTRIBUTES: readonly string[] = ['className', 'class'];
const DEFAULT_CLASS_FUNCTIONS: readonly string[] = [
  'cn',
  'clsx',
  'classnames',
  'classNames',
  'cx',
  'cva',
  'tv',
  'twMerge',
  'twJoin',
];
const DEFAULT_STYLE_ATTRIBUTES: readonly string[] = ['style'];
const DEFAULT_CSS_TAGS: readonly string[] = ['styled', 'css', 'keyframes'];
// Variables Base UI sets on popups at runtime; they are measurements, not design values.
const DEFAULT_ALLOWED_VARS: readonly string[] = [
  '--transform-origin',
  '--anchor-width',
  '--anchor-height',
  '--available-width',
  '--available-height',
];
const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
  '**/*.stories.{js,jsx,ts,tsx,mdx}',
  '**/__tests__/**',
];

const stringList = (description: string): JSONSchema4 => ({
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description,
});

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: [...DESIGN_CATEGORIES] },
      uniqueItems: true,
      default: [...DESIGN_CATEGORIES],
      description: 'The kinds of design value to check. Default: all of them.',
    },
    allowedVarPrefixes: stringList(
      'Prefixes a token CSS variable starts with (`--color-`). When set, any other variable is reported. When unset, every CSS variable counts as a token.',
    ),
    allowedVars: {
      ...stringList('CSS variables allowed whatever their prefix, such as runtime geometry a headless library sets.'),
      default: [...DEFAULT_ALLOWED_VARS],
    },
    allowedValues: {
      ...stringList('Class tokens or CSS values that are always allowed (`text-white`, `1px`).'),
      default: [],
    },
    fontNames: {
      ...stringList('Font names whose `font-<name>` utility is reported (`inter` reports `font-inter`).'),
      default: [],
    },
    classAttributes: {
      ...stringList('JSX attributes that hold class strings.'),
      default: [...DEFAULT_CLASS_ATTRIBUTES],
    },
    classFunctions: {
      ...stringList('Functions whose string arguments are class strings.'),
      default: [...DEFAULT_CLASS_FUNCTIONS],
    },
    styleAttributes: {
      ...stringList('JSX attributes that hold an inline style object.'),
      default: [...DEFAULT_STYLE_ATTRIBUTES],
    },
    checkStyleObjects: {
      type: 'boolean',
      default: true,
      description: 'Check inline style objects.',
    },
    cssTags: {
      ...stringList('Tags of CSS-in-JS tagged templates, matched on the name the tag starts with (`styled` matches `styled.div` and `styled(Button)`).'),
      default: [...DEFAULT_CSS_TAGS],
    },
    allowIn: stringList('File-path globs the rule skips. Default: tests and stories.'),
  },
};

/** The name a tag expression starts with: `styled.div.attrs(...)` → `styled`. */
function tagRoot(node: TSESTree.Node): string | null {
  let current = node;
  for (;;) {
    if (current.type === AST_NODE_TYPES.Identifier) {
      return current.name;
    }
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.CallExpression) {
      current = current.callee;
    } else {
      return null;
    }
  }
}

/** A JSX attribute's plain name (`className`), or null for a namespaced one. */
function attributeName(attribute: TSESTree.JSXAttribute): string | null {
  return attribute.name.type === AST_NODE_TYPES.JSXIdentifier ? attribute.name.name : null;
}

/** A property's static key, or null for a computed one. */
function propertyKey(property: TSESTree.Property): string | null {
  if (property.computed) {
    return null;
  }
  if (property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

export const noHardcodedDesignValuesRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow hardcoded colours, spacing, font sizes and families, radii, shadows and motion in class strings, inline styles and CSS-in-JS, so a theme can restyle components through design tokens.',
    },
    schema: [optionSchema],
    messages: {
      paletteClass:
        'Class `{{token}}` takes its colour straight from the Tailwind palette, so a theme cannot change it. Use a token utility (a theme colour such as `bg-primary` or `text-muted-foreground`).',
      fontNameClass:
        'Class `{{token}}` names a font directly. Use the semantic family token (such as `font-sans` or `font-heading`).',
      hardcodedClass:
        'Class `{{token}}` hardcodes a {{category}} value, so a theme cannot change it. Use a token utility or a token CSS variable (`(--name)` / `[var(--name)]`).',
      hardcodedStyle:
        '`{{property}}: {{value}}` hardcodes a {{category}} value, so a theme cannot change it. Use a design token (`var(--name)`).',
      disallowedVar:
        '`{{name}}` is not a design token: token variables start with {{prefixes}}. Use a token, or add the variable to `allowedVars` if it is runtime geometry.',
    },
  },
  defaultOptions: [
    {
      categories: DESIGN_CATEGORIES,
      allowedVars: DEFAULT_ALLOWED_VARS,
      allowedValues: [],
      fontNames: [],
      classAttributes: DEFAULT_CLASS_ATTRIBUTES,
      classFunctions: DEFAULT_CLASS_FUNCTIONS,
      styleAttributes: DEFAULT_STYLE_ATTRIBUTES,
      checkStyleObjects: true,
      cssTags: DEFAULT_CSS_TAGS,
    },
  ],
  create(context, [options]) {
    if (fileMatchesAnyGlob(context.filename, resolveAllowIn(options, [], DEFAULT_ALLOW_IN), context.cwd)) {
      return {};
    }
    const policy: DesignPolicy = {
      categories: new Set(options.categories ?? DESIGN_CATEGORIES),
      varPrefixes: options.allowedVarPrefixes ?? null,
      allowedVars: new Set(options.allowedVars ?? DEFAULT_ALLOWED_VARS),
      allowedValues: new Set(options.allowedValues ?? []),
      fontNames: new Set((options.fontNames ?? []).map((name) => name.toLowerCase())),
    };
    const classAttributes = new Set(options.classAttributes ?? DEFAULT_CLASS_ATTRIBUTES);
    const classFunctions = new Set(options.classFunctions ?? DEFAULT_CLASS_FUNCTIONS);
    const styleAttributes = new Set(options.styleAttributes ?? DEFAULT_STYLE_ATTRIBUTES);
    const checkStyleObjects = options.checkStyleObjects ?? true;
    const cssTags = new Set(options.cssTags ?? DEFAULT_CSS_TAGS);
    const prefixes = (options.allowedVarPrefixes ?? []).map((prefix) => `\`${prefix}\``).join(', ');

    const reportVariable = (node: TSESTree.Node, name: string): void => {
      context.report({ node, messageId: 'disallowedVar', data: { name, prefixes } });
    };

    const reportClassFindings = (node: TSESTree.Node, token: string, findings: DesignFinding[]): void => {
      for (const finding of findings) {
        if (finding.kind === 'palette') {
          context.report({ node, messageId: 'paletteClass', data: { token } });
        } else if (finding.kind === 'fontName') {
          context.report({ node, messageId: 'fontNameClass', data: { token } });
        } else if (finding.kind === 'variable') {
          reportVariable(node, finding.name);
        } else {
          context.report({
            node,
            messageId: 'hardcodedClass',
            data: { token, category: CATEGORY_LABELS[finding.category] },
          });
        }
      }
    };

    const reportCssFindings = (
      node: TSESTree.Node,
      property: string,
      value: string,
      findings: DesignFinding[],
    ): void => {
      for (const finding of findings) {
        if (finding.kind === 'variable') {
          reportVariable(node, finding.name);
        } else if (finding.kind === 'value') {
          context.report({
            node,
            messageId: 'hardcodedStyle',
            data: { property, value: value.trim(), category: CATEGORY_LABELS[finding.category] },
          });
        }
      }
    };

    /** Check the class tokens of one string; tokens cut by an interpolation are skipped. */
    const checkClassText = (node: TSESTree.Node, text: string, openStart: boolean, openEnd: boolean): void => {
      const tokens = text.split(/\s+/u);
      tokens.forEach((token, index) => {
        if (token === '') return;
        if ((index === 0 && openStart) || (index === tokens.length - 1 && openEnd)) return;
        reportClassFindings(node, token, checkClassToken(token, policy));
      });
    };

    /** Walk an expression that yields class strings: literals, templates, branches, arrays, objects. */
    const checkClassExpression = (node: TSESTree.Node): void => {
      switch (node.type) {
        case AST_NODE_TYPES.Literal:
          if (typeof node.value === 'string') checkClassText(node, node.value, false, false);
          return;
        case AST_NODE_TYPES.TemplateLiteral:
          node.quasis.forEach((quasi, index) => {
            const text = quasi.value.cooked ?? '';
            checkClassText(
              quasi,
              text,
              index > 0 && !/^\s/u.test(text),
              index < node.quasis.length - 1 && !/\s$/u.test(text),
            );
          });
          return;
        case AST_NODE_TYPES.ConditionalExpression:
          checkClassExpression(node.consequent);
          checkClassExpression(node.alternate);
          return;
        case AST_NODE_TYPES.LogicalExpression:
          checkClassExpression(node.left);
          checkClassExpression(node.right);
          return;
        case AST_NODE_TYPES.ArrayExpression:
          for (const element of node.elements) {
            if (element !== null) checkClassExpression(element);
          }
          return;
        case AST_NODE_TYPES.ObjectExpression:
          for (const property of node.properties) {
            if (property.type === AST_NODE_TYPES.SpreadElement) continue;
            if (!property.computed && property.key.type === AST_NODE_TYPES.Literal) {
              checkClassExpression(property.key);
            }
            checkClassExpression(property.value);
          }
          return;
        case AST_NODE_TYPES.SpreadElement:
        case AST_NODE_TYPES.TSAsExpression:
        case AST_NODE_TYPES.TSSatisfiesExpression:
          checkClassExpression(node.type === AST_NODE_TYPES.SpreadElement ? node.argument : node.expression);
          return;
        default:
          // A call (a nested `cn()` is checked on its own; `el.closest('[data-x]')`
          // is not a class string), an identifier or anything else is not read.
          return;
      }
    };

    /** The literal text of a style value, or null when it is not a literal. */
    const literalStyleValue = (node: TSESTree.Node): string | null => {
      if (node.type === AST_NODE_TYPES.Literal) {
        if (typeof node.value === 'string') return node.value;
        // React appends `px` to a bare number.
        if (typeof node.value === 'number') return node.value === 0 ? '0' : `${node.value}px`;
        return null;
      }
      if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked ?? null;
      }
      return null;
    };

    const checkStyleValue = (property: string, node: TSESTree.Node): void => {
      if (node.type === AST_NODE_TYPES.ConditionalExpression) {
        checkStyleValue(property, node.consequent);
        checkStyleValue(property, node.alternate);
        return;
      }
      const value = literalStyleValue(node);
      if (value === null) return;
      const category = propertyCategory(property);
      // Unitless numbers (`lineHeight: 1.5`, `zIndex: 10`) are only lengths in a length category.
      const unitless =
        node.type === AST_NODE_TYPES.Literal && typeof node.value === 'number' && category === null;
      const read = unitless ? '' : value;
      reportCssFindings(node, property, context.sourceCode.getText(node), checkCssValue(category, read, policy));
    };

    const checkStyleObject = (node: TSESTree.Node): void => {
      if (node.type === AST_NODE_TYPES.ConditionalExpression) {
        checkStyleObject(node.consequent);
        checkStyleObject(node.alternate);
        return;
      }
      if (node.type === AST_NODE_TYPES.LogicalExpression) {
        checkStyleObject(node.right);
        return;
      }
      if (node.type !== AST_NODE_TYPES.ObjectExpression) return;
      for (const property of node.properties) {
        if (property.type !== AST_NODE_TYPES.Property) continue;
        const key = propertyKey(property);
        // A custom property definition (`'--progress': '40%'`) sets a variable, it does not style.
        if (key === null || key.startsWith('--')) continue;
        if (property.value.type === AST_NODE_TYPES.ObjectExpression) continue;
        checkStyleValue(key, property.value);
      }
    };

    return {
      JSXAttribute(node): void {
        const name = attributeName(node);
        if (name === null || node.value === null) return;
        const value =
          node.value.type === AST_NODE_TYPES.JSXExpressionContainer ? node.value.expression : node.value;
        if (value.type === AST_NODE_TYPES.JSXEmptyExpression) return;
        if (classAttributes.has(name)) {
          checkClassExpression(value);
        } else if (checkStyleObjects && styleAttributes.has(name)) {
          checkStyleObject(value);
        }
      },
      CallExpression(node): void {
        if (node.callee.type === AST_NODE_TYPES.Identifier && classFunctions.has(node.callee.name)) {
          node.arguments.forEach(checkClassExpression);
        }
      },
      TaggedTemplateExpression(node): void {
        const root = tagRoot(node.tag);
        if (root === null || !cssTags.has(root)) return;
        // Interpolations become a placeholder, so `color: ${theme.fg};` reads as no literal value.
        const css = node.quasi.quasis.map((quasi) => quasi.value.cooked ?? '').join(' __interpolation__ ');
        for (const [property, rawValue] of cssDeclarations(css)) {
          const findings = checkCssValue(
            propertyCategory(property),
            rawValue.replace(/__interpolation__/gu, ' '),
            policy,
          );
          const shown = rawValue.replace(/\s*__interpolation__\s*/gu, ' ${...} ');
          reportCssFindings(node.quasi, property, shown, findings);
        }
      },
    };
  },
});
