import { allowInAliasDescription, fileMatchesAnyGlob, resolveAllowIn, toPosixPath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'money-must-be-decimal';

export interface MoneyMustBeDecimalOptions {
  /** Name of the domain money type to require (e.g. `Decimal`, `Money`, `BigDecimal`). */
  readonly decimalType?: string;
  /** Regex fragments (case-insensitive) identifying money-named fields. */
  readonly fieldPatterns?: readonly string[];
  /**
   * Files to skip entirely, as globs (`**\/legacy/**`). A plain path is a path
   * suffix matched at a directory boundary (`apps/api/src/legacy/totals.ts`).
   */
  readonly allowIn?: readonly string[];
  /** @deprecated Use `allowIn`. */
  readonly allowedFiles?: readonly string[];
  /**
   * Regex fragments (case-insensitive) naming fields that hold an integer count
   * of minor units (cents), where `number` is the correct type. A money-named
   * field matching one of these is not reported. Empty by default.
   */
  readonly minorUnitPatterns?: readonly string[];
  /**
   * Name segments that mark a count rather than money (`totalPages`,
   * `totalCount`, `priceIndex`). A money-named field with one of these words
   * is not reported. Matched case-insensitively against whole camelCase,
   * snake_case or kebab-case words.
   */
  readonly counterWords?: readonly string[];
  /** Also check `z.number()` under a money-named key in a `z.object({...})`. On by default. */
  readonly checkZod?: boolean;
  /** Zod namespace identifiers (`z`, or a renamed import). */
  readonly zodIdentifiers?: readonly string[];
  /** Also check interface and type-literal members (`interface Invoice { amount: number }`). Off by default. */
  readonly checkTypeMembers?: boolean;
  /** Also check function parameters (`function pay(amount: number)`). Off by default. */
  readonly checkParameters?: boolean;
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
 *   - Class properties (PropertyDefinition), annotated variable declarators
 *     (VariableDeclarator) and `z.number()` under a money-named key of a
 *     `z.object({...})` are covered by default. Interface / type-literal
 *     members and function parameters are opt-in (`checkTypeMembers`,
 *     `checkParameters`) so non-money `amount: number` type members (progress,
 *     fixtures) do not regress for projects that have not asked for them.
 *   - A name with a counter word (`totalPages`, `totalCount`, `priceIndex`) is
 *     a count, not money. A bare `total` on a pagination-shaped class or type
 *     (`PageMetaDto`, `PaginatedResult`) is the item count and is skipped too.
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

const DEFAULT_COUNTER_WORDS: readonly string[] = [
  'count',
  'counts',
  'pages',
  'page',
  'items',
  'rows',
  'records',
  'results',
  'index',
  'idx',
  'hits',
  'num',
  'number',
];

/** A container name that says the type describes a page of results. */
const PAGINATION_CONTAINER = /(?:page|paginat|pager|cursor)/iu;

/** camelCase / PascalCase / snake_case / kebab-case words, lower-cased. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[\s_\-$]+/u)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/*
 * Payment APIs such as Stripe carry money as an integer count of minor units
 * (`amount: 1999` is 19.99), which is exact in a `number`. How a codebase names
 * those fields is its own convention (`amount`, `amountCents`, `unitAmount`), so
 * nothing is exempt until the consumer lists the patterns.
 */
const DEFAULT_MINOR_UNIT_PATTERNS: readonly string[] = [];

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
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Files to skip entirely, as globs. A plain path is a path suffix matched at a directory boundary.',
    },
    allowedFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: allowInAliasDescription('allowedFiles'),
    },
    minorUnitPatterns: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    },
    counterWords: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    checkZod: { type: 'boolean' },
    zodIdentifiers: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    checkTypeMembers: { type: 'boolean' },
    checkParameters: { type: 'boolean' },
  },
};

/**
 * An `allowedFiles` entry as a glob. A plain path keeps its old meaning, a path
 * suffix (`apps/api/src/legacy/totals.ts` matches wherever the repo sits), by
 * gaining a leading `**\/`; it now matches at a directory boundary, so
 * `totals.ts` no longer matches `subtotals.ts`. An entry that already starts
 * with `**\/` or `/` is used as written.
 */
function toAllowGlob(entry: string): string {
  const posix = toPosixPath(entry);
  return posix.startsWith('**/') || posix.startsWith('/') ? posix : `**/${posix}`;
}

/** The plain string name of a property/identifier key, or undefined if computed/dynamic. */
function staticName(node: TSESTree.Node): string | undefined {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value;
  }
  return undefined;
}

/** Name of the class, interface or type alias a member belongs to, if any. */
function containerName(node: TSESTree.Node): string | null {
  for (let current: TSESTree.Node | undefined = node.parent; current; current = current.parent) {
    if (
      (current.type === AST_NODE_TYPES.ClassDeclaration || current.type === AST_NODE_TYPES.ClassExpression) &&
      current.id !== null
    ) {
      return current.id.name;
    }
    if (current.type === AST_NODE_TYPES.TSInterfaceDeclaration || current.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
      return current.id.name;
    }
    if (current.type === AST_NODE_TYPES.VariableDeclarator && current.id.type === AST_NODE_TYPES.Identifier) {
      return current.id.name;
    }
  }
  return null;
}

const NULLISH_TYPES: ReadonlySet<AST_NODE_TYPES> = new Set([
  AST_NODE_TYPES.TSNullKeyword,
  AST_NODE_TYPES.TSUndefinedKeyword,
]);

/**
 * True when the annotation is the primitive `number`, alone or made optional
 * with `null` / `undefined` (`number | null`).
 */
function isNumberAnnotation(annotation: TSESTree.TSTypeAnnotation | undefined): boolean {
  const type = annotation?.typeAnnotation;
  if (type === undefined) {
    return false;
  }
  if (type.type === AST_NODE_TYPES.TSNumberKeyword) {
    return true;
  }
  return (
    type.type === AST_NODE_TYPES.TSUnionType &&
    type.types.some((member) => member.type === AST_NODE_TYPES.TSNumberKeyword) &&
    type.types.every((member) => member.type === AST_NODE_TYPES.TSNumberKeyword || NULLISH_TYPES.has(member.type))
  );
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
      minorUnitPatterns: [],
      counterWords: [...DEFAULT_COUNTER_WORDS],
      checkZod: true,
      zodIdentifiers: ['z'],
      checkTypeMembers: false,
      checkParameters: false,
    },
  ],
  create(context, [options]) {
    const decimalType = options.decimalType ?? DEFAULT_DECIMAL_TYPE;
    const allowedFiles = resolveAllowIn(options, ['allowedFiles'], DEFAULT_ALLOWED_FILES).map(toAllowGlob);

    if (fileMatchesAnyGlob(context.filename, allowedFiles, context.cwd)) {
      return {};
    }

    const fieldPatterns = options.fieldPatterns ?? DEFAULT_FIELD_PATTERNS;
    const moneyPattern = new RegExp(`(${fieldPatterns.join('|')})`, 'i');
    const minorUnitPatterns = options.minorUnitPatterns ?? DEFAULT_MINOR_UNIT_PATTERNS;
    const minorUnitPattern =
      minorUnitPatterns.length > 0 ? new RegExp(`(${minorUnitPatterns.join('|')})`, 'i') : null;

    const counterWords = new Set((options.counterWords ?? DEFAULT_COUNTER_WORDS).map((word) => word.toLowerCase()));
    const zodIdentifiers = new Set(options.zodIdentifiers ?? ['z']);

    /**
     * A money-named field that is not a minor-unit integer, not a count
     * (`totalPages`), and not the bare `total` of a pagination-shaped container.
     */
    function isDecimalMoneyName(name: string, node: TSESTree.Node): boolean {
      if (!moneyPattern.test(name) || (minorUnitPattern?.test(name) ?? false)) {
        return false;
      }
      const words = nameWords(name);
      if (words.some((word) => counterWords.has(word))) {
        return false;
      }
      if (words.length === 1 && words[0] === 'total') {
        const container = containerName(node);
        if (container !== null && PAGINATION_CONTAINER.test(container)) {
          return false;
        }
      }
      return true;
    }

    function report(node: TSESTree.Node): void {
      context.report({ node, messageId: 'moneyMustBeDecimal', data: { decimalType } });
    }

    /** `z.number()`, possibly chained (`z.number().positive()`, `.nullable()`). */
    function isZodNumber(node: TSESTree.Node): boolean {
      let current: TSESTree.Node = node;
      while (current.type === AST_NODE_TYPES.CallExpression && current.callee.type === AST_NODE_TYPES.MemberExpression) {
        const callee = current.callee;
        if (
          callee.object.type === AST_NODE_TYPES.Identifier &&
          zodIdentifiers.has(callee.object.name) &&
          callee.property.type === AST_NODE_TYPES.Identifier
        ) {
          return callee.property.name === 'number';
        }
        current = callee.object;
      }
      return false;
    }

    function isZodObjectCall(node: TSESTree.Node | undefined): boolean {
      return (
        node?.type === AST_NODE_TYPES.CallExpression &&
        node.callee.type === AST_NODE_TYPES.MemberExpression &&
        node.callee.object.type === AST_NODE_TYPES.Identifier &&
        zodIdentifiers.has(node.callee.object.name) &&
        node.callee.property.type === AST_NODE_TYPES.Identifier &&
        (node.callee.property.name === 'object' || node.callee.property.name === 'strictObject')
      );
    }

    function checkParams(params: readonly TSESTree.Parameter[]): void {
      for (const raw of params) {
        const param = raw.type === AST_NODE_TYPES.AssignmentPattern ? raw.left : raw;
        if (param.type === AST_NODE_TYPES.Identifier && isNumberAnnotation(param.typeAnnotation) && isDecimalMoneyName(param.name, param)) {
          report(param);
        }
      }
    }

    const optional: TSESLint.RuleListener = {};
    if (options.checkTypeMembers === true) {
      // `interface Invoice { amount: number }` / `type T = { price: number }`.
      optional.TSPropertySignature = (node: TSESTree.TSPropertySignature): void => {
        const name = node.computed ? undefined : staticName(node.key);
        if (name !== undefined && isNumberAnnotation(node.typeAnnotation) && isDecimalMoneyName(name, node)) {
          report(node);
        }
      };
    }
    if (options.checkParameters === true) {
      optional.FunctionDeclaration = (node: TSESTree.FunctionDeclaration): void => checkParams(node.params);
      optional.FunctionExpression = (node: TSESTree.FunctionExpression): void => checkParams(node.params);
      optional.ArrowFunctionExpression = (node: TSESTree.ArrowFunctionExpression): void => checkParams(node.params);
    }
    if (options.checkZod !== false) {
      // `z.object({ amount: z.number() })`.
      optional.Property = (node: TSESTree.Property): void => {
        if (node.computed || !isZodObjectCall(node.parent.parent) || node.parent.parent?.type !== AST_NODE_TYPES.CallExpression) {
          return;
        }
        if (node.parent.parent.arguments[0] !== node.parent) {
          return;
        }
        const name = staticName(node.key);
        if (name !== undefined && isZodNumber(node.value) && isDecimalMoneyName(name, node)) {
          report(node);
        }
      };
    }

    return {
      ...optional,
      // `class Invoice { total: number }`: class field explicitly typed number.
      PropertyDefinition(node): void {
        if (node.computed) {
          return;
        }
        const name = staticName(node.key);
        if (
          name !== undefined &&
          isDecimalMoneyName(name, node) &&
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
        if (isDecimalMoneyName(name, node) && isNumberAnnotation(node.id.typeAnnotation)) {
          report(node);
        }
      },
    };
  },
});
