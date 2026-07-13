import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'money-must-be-decimal';

export interface MoneyMustBeDecimalOptions {
  /** Name of the domain money type to require (e.g. `Decimal`, `Money`, `BigDecimal`). */
  readonly decimalType?: string;
  /** Regex fragments (case-insensitive) identifying money-named fields. */
  readonly fieldPatterns?: readonly string[];
  /** Path-suffix allowlist of files to skip entirely. */
  readonly allowedFiles?: readonly string[];
}

type RuleOptions = [MoneyMustBeDecimalOptions];
type MessageIds = 'moneyMustBeDecimal';

/*
 * Monetary amounts stored as a JS `number` accumulate IEEE-754 rounding errors
 * (0.1 + 0.2 !== 0.3), unacceptable for accounting figures. This rule is a
 * DORMANT guard: it fires only when a money-named field is EXPLICITLY typed as
 * the primitive `number`, so it stays green on a codebase with no money fields
 * yet and lights up the moment one is introduced with the wrong type.
 *
 * De-projected from shiroani: the money type name and the money-field name
 * pattern are both options (no hard-coded `Prisma.Decimal` / Polish-accounting
 * names). Conservative on purpose:
 *   - Only an explicit `: number` annotation (TSNumberKeyword) is flagged.
 *     Untyped declarations and numeric-literal initializers are NOT flagged
 *     (those catch loop counters/accumulators like `let total = 0`).
 *   - Only class properties (PropertyDefinition) and annotated variable
 *     declarators (VariableDeclarator) are covered. Interface / type-literal
 *     members (TSPropertySignature) are intentionally excluded so non-money
 *     `amount: number` type members (progress, fixtures) do not regress.
 */
const DEFAULT_DECIMAL_TYPE = 'Decimal';

const DEFAULT_FIELD_PATTERNS: readonly string[] = [
  'amount',
  'price',
  'cost',
  'total',
  'balance',
];

const DEFAULT_ALLOWED_FILES: readonly string[] = [];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decimalType: { type: 'string', minLength: 1 },
    fieldPatterns: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
    allowedFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

/** Forward-slash form of a filename so suffix matching is OS-independent. */
function toForwardSlash(filename: string): string {
  return filename.split('\\').join('/');
}

/**
 * True when the file is covered by one of the allowlist entries. An entry
 * matches when the (forward-slashed) filename ends with it, so callers can pass
 * a path suffix like `apps/api/src/legacy/totals.ts`. An empty list allowlists
 * nothing (the rule stays active everywhere).
 */
function isAllowedFile(filename: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = toForwardSlash(filename);
  return patterns.some((pattern) => normalized.endsWith(toForwardSlash(pattern)));
}

/** The plain string name of a property/identifier key, or undefined if computed/dynamic. */
function staticName(node: TSESTree.Node): string | undefined {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  return undefined;
}

/** True when the annotation node directly resolves to the primitive `number`. */
function isNumberAnnotation(annotation: TSESTree.TSTypeAnnotation | undefined): boolean {
  return annotation?.typeAnnotation.type === AST_NODE_TYPES.TSNumberKeyword;
}

export const moneyMustBeDecimalRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow monetary values typed as the JS primitive `number`. Money-named fields explicitly typed `: number` lose precision to float rounding; use a Decimal money type instead.',
    },
    schema: [optionSchema],
    messages: {
      moneyMustBeDecimal:
        'Monetary values must use {{decimalType}}, never the JS `number` primitive, to avoid float rounding errors. Rename or retype this field to a {{decimalType}} money type.',
    },
  },
  defaultOptions: [
    {
      decimalType: DEFAULT_DECIMAL_TYPE,
      fieldPatterns: [...DEFAULT_FIELD_PATTERNS],
      allowedFiles: [],
    },
  ],
  create(context, [options]) {
    const decimalType = options.decimalType ?? DEFAULT_DECIMAL_TYPE;
    const allowedFiles = options.allowedFiles ?? DEFAULT_ALLOWED_FILES;

    if (isAllowedFile(context.filename, allowedFiles)) {
      return {};
    }

    const fieldPatterns = options.fieldPatterns ?? DEFAULT_FIELD_PATTERNS;
    const moneyPattern = new RegExp(`(${fieldPatterns.join('|')})`, 'i');

    function report(node: TSESTree.Node): void {
      context.report({ node, messageId: 'moneyMustBeDecimal', data: { decimalType } });
    }

    return {
      // `class Invoice { total: number }`: class field explicitly typed number.
      PropertyDefinition(node): void {
        if (node.computed) {
          return;
        }
        const name = staticName(node.key);
        if (
          name !== undefined &&
          moneyPattern.test(name) &&
          isNumberAnnotation(node.typeAnnotation)
        ) {
          report(node);
        }
      },
      // `const total: number = ...`: annotated variable declarator.
      VariableDeclarator(node): void {
        if (node.id.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        const name = node.id.name;
        if (moneyPattern.test(name) && isNumberAnnotation(node.id.typeAnnotation)) {
          report(node);
        }
      },
    };
  },
});
