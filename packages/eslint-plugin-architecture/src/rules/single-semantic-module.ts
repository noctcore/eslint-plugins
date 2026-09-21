/*
 * Ported from @boring-stack-pkg/eslint-plugin-module-boundaries 0.2.0
 * (MIT License, Copyright (c) 2026 the boringstack-xyz/eslint-plugins authors).
 * Provenance: boringstack-xyz/eslint-plugins@1f014dc,
 * eslint-plugin-module-boundaries/src/rules/singleSemanticModule.ts.
 * Ported rather than consumed: upstream peers `eslint: 8.57.0 || ^9.0.0`.
 */
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { analyzeSemanticModule, buildMixedCategoriesMessage } from '../semantic-module/classify';
import {
  DEFAULT_OPTIONS,
  isCategorySetAllowed,
  SCHEMA_LIBRARIES,
  SEMANTIC_CATEGORIES,
  type SingleSemanticModuleOptions,
} from '../semantic-module/options';

const RULE_NAME = 'single-semantic-module';

export type { SingleSemanticModuleOptions };

type RuleOptions = [SingleSemanticModuleOptions];
type MessageIds = 'mixedSemanticCategories';

/*
 * One module, one semantic concern. Every exported top-level declaration is
 * classified by its AST shape (never its filename) as one of `type`,
 * `constant`, `function`, `class`, `react-component`, `hook`, `schema` or
 * `enum`, and a module whose classifications span more than one category is
 * reported unless an `allow` group covers them all.
 *
 * Non-exported declarations are ignored by default (`ignorePrivateDeclarations`):
 * a render helper beside a component, or a filter object inside a hook file,
 * serves the exported surface and is not a second concern. That default is
 * the difference between this rule and the upstream one people turned off.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allow: {
      type: 'array',
      items: {
        type: 'array',
        minItems: 2,
        uniqueItems: true,
        items: { type: 'string', enum: [...SEMANTIC_CATEGORIES] },
      },
    },
    enumCategory: { type: 'string', enum: ['enum', 'type'] },
    debug: { type: 'boolean' },
    ignoreAmbientDeclarations: { type: 'boolean' },
    ignorePrivateDeclarations: { type: 'boolean' },
    schemaLibraries: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', enum: [...SCHEMA_LIBRARIES] },
    },
    reactComponentDetection: {
      type: 'object',
      additionalProperties: false,
      properties: { enabled: { type: 'boolean' } },
    },
    hookDetection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        namePattern: { type: 'string' },
      },
    },
  },
};

export const singleSemanticModuleRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require each module to export only one semantic concern (types, constants, functions, classes, components, hooks, schemas or enums).',
    },
    schema: [optionSchema],
    messages: {
      mixedSemanticCategories: '{{message}}',
    },
  },
  defaultOptions: [DEFAULT_OPTIONS],
  create(context, [options]) {
    return {
      Program(program): void {
        const analysis = analyzeSemanticModule(program, options);
        if (isCategorySetAllowed(analysis.categories, analysis.options.allow)) {
          return;
        }
        // Report on the first declaration whose category differs from the
        // first one's: that is where the second concern starts. (Upstream
        // reported the second declaration, which may share the first's category.)
        const [first] = analysis.classifications;
        const reportNode =
          analysis.classifications.find((entry) => entry.category !== first?.category)?.node ??
          program;
        context.report({
          node: reportNode,
          messageId: 'mixedSemanticCategories',
          data: {
            message: buildMixedCategoriesMessage(analysis.classifications, analysis.options.debug),
          },
        });
      },
    };
  },
});
