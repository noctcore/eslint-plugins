import path from 'node:path';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getFeatureName } from '../utils';

const RULE_NAME = 'no-cross-feature-imports';

export interface NoCrossFeatureImportsOptions {
  readonly featureRoot?: string;
  readonly alias?: string;
  readonly sharedFeatures?: readonly string[];
  readonly allowTypeImports?: boolean;
}

type RuleOptions = [NoCrossFeatureImportsOptions];
type MessageIds = 'crossFeatureImport';

/*
 * A file in feature `A` may not import runtime code from feature `B`: features
 * stay decoupled so a change in one cannot ripple into another. Shared code
 * lives outside the feature root or in a designated shared feature (default
 * `ui`, importable by all). Type-only imports are allowed by default
 * (`allowTypeImports: false` forbids them — type-level coupling ripples all the
 * same). Both the alias form (`<alias>/<feature>`) and relative paths that climb
 * into another feature are detected, on every source-carrying construct: static
 * imports, dynamic `import()`, and `export … from` / `export * from` re-export
 * laundering.
 *
 * De-projected from nightcore: `featureRoot` (the anchor segment), `alias` (the
 * import alias prefix), and `sharedFeatures` (the shared allowlist) are options.
 */
const DEFAULT_FEATURE_ROOT = 'components';
const DEFAULT_ALIAS = '@/components';
const DEFAULT_SHARED_FEATURES: readonly string[] = ['ui'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    featureRoot: { type: 'string' },
    alias: { type: 'string' },
    sharedFeatures: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    allowTypeImports: { type: 'boolean' },
  },
};

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<alias>/<feature>` matcher — captures the first segment after the alias. */
function aliasFeatureMatcher(alias: string): RegExp {
  return new RegExp(`^${escapeRegExpLiteral(alias)}/([^/]+)`);
}

function resolveTargetFeature(
  source: string,
  currentFile: string,
  aliasRe: RegExp,
  featureRoot: string,
): string | null {
  const aliasMatch = aliasRe.exec(source);
  if (aliasMatch) {
    return aliasMatch[1] ?? null;
  }
  if (source.startsWith('.')) {
    const resolved = path.resolve(path.dirname(currentFile), source);
    return getFeatureName(resolved, featureRoot);
  }
  return null;
}

export const noCrossFeatureImportsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A file in one feature may not import runtime code from another feature. Move shared code to a shared module or a shared feature.',
    },
    schema: [optionSchema],
    messages: {
      crossFeatureImport:
        'Cross-feature import: `{{current}}` may not import runtime code from `{{root}}/{{target}}`. Move shared code to a shared module or a shared feature (e.g. `{{root}}/ui`).',
    },
  },
  defaultOptions: [
    {
      featureRoot: DEFAULT_FEATURE_ROOT,
      alias: DEFAULT_ALIAS,
      sharedFeatures: [...DEFAULT_SHARED_FEATURES],
      allowTypeImports: true,
    },
  ],
  create(context, [options]) {
    const featureRoot = options.featureRoot ?? DEFAULT_FEATURE_ROOT;
    const alias = options.alias ?? DEFAULT_ALIAS;
    const sharedFeatures = options.sharedFeatures ?? DEFAULT_SHARED_FEATURES;
    const allowTypeImports = options.allowTypeImports ?? true;
    const aliasRe = aliasFeatureMatcher(alias);

    const current = getFeatureName(context.filename, featureRoot);
    if (current === null) {
      return {};
    }

    function checkSource(sourceNode: TSESTree.Literal, typeOnly: boolean): void {
      if (allowTypeImports && typeOnly) {
        return;
      }
      const source = sourceNode.value;
      if (typeof source !== 'string') {
        return;
      }
      const target = resolveTargetFeature(source, context.filename, aliasRe, featureRoot);
      if (target === null || target === current || sharedFeatures.includes(target)) {
        return;
      }
      context.report({
        node: sourceNode,
        messageId: 'crossFeatureImport',
        data: { current, target, root: featureRoot },
      });
    }

    return {
      ImportDeclaration(node): void {
        if (node.source.type === AST_NODE_TYPES.Literal) {
          checkSource(node.source, node.importKind === 'type');
        }
      },
      // Dynamic `import()` is runtime by nature — never type-only.
      ImportExpression(node): void {
        if (node.source.type === AST_NODE_TYPES.Literal) {
          checkSource(node.source, false);
        }
      },
      // `export { x } from '…'` re-export laundering.
      ExportNamedDeclaration(node): void {
        if (node.source !== null && node.source.type === AST_NODE_TYPES.Literal) {
          checkSource(node.source, node.exportKind === 'type');
        }
      },
      // `export * from '…'` re-export laundering.
      ExportAllDeclaration(node): void {
        if (node.source.type === AST_NODE_TYPES.Literal) {
          checkSource(node.source, node.exportKind === 'type');
        }
      },
    };
  },
});
