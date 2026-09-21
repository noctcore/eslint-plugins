/*
 * Ported from @boring-stack-pkg/eslint-plugin-module-boundaries 0.2.0
 * (MIT License, Copyright (c) 2026 the boringstack-xyz/eslint-plugins authors).
 * Provenance: boringstack-xyz/eslint-plugins@1f014dc,
 * eslint-plugin-module-boundaries/src/classifiers/categories.ts,
 * src/utils/config.ts and src/utils/allowedCombinations.ts.
 * Changed in the port: `ignorePrivateDeclarations` defaults to true, and an
 * invalid `hookDetection.namePattern` is a config error instead of silently
 * falling back to the default pattern.
 */
import type { TSESTree } from '@typescript-eslint/utils';

export const SEMANTIC_CATEGORIES = [
  'type',
  'constant',
  'function',
  'class',
  'react-component',
  'hook',
  'schema',
  'enum',
] as const;

export type SemanticCategory = (typeof SEMANTIC_CATEGORIES)[number];

export type EnumCategory = Extract<SemanticCategory, 'enum' | 'type'>;

export type SchemaLibrary = 'zod' | 'yup' | 'valibot';

export const SCHEMA_LIBRARIES: readonly SchemaLibrary[] = ['zod', 'yup', 'valibot'];

export interface SemanticClassification {
  readonly category: SemanticCategory;
  readonly node: TSESTree.Node;
  readonly declarationName?: string;
  readonly reason: string;
}

/** Categories in their canonical (declaration) order, de-duplicated. */
export function sortCategories(categories: Iterable<SemanticCategory>): SemanticCategory[] {
  const categorySet = new Set(categories);
  return SEMANTIC_CATEGORIES.filter((category) => categorySet.has(category));
}

export interface SingleSemanticModuleOptions {
  /** Category sets a module may mix, e.g. `[['constant', 'type', 'enum']]`. */
  readonly allow?: readonly (readonly SemanticCategory[])[];
  /** Whether a TS `enum` is its own category or counts as `type`. */
  readonly enumCategory?: EnumCategory;
  /** List every classified declaration and why in the report. */
  readonly debug?: boolean;
  /** Skip `declare ...` and `declare global` blocks entirely. */
  readonly ignoreAmbientDeclarations?: boolean;
  /**
   * Only the exported surface defines a module's semantics: a non-exported
   * render helper, config object or class serves that surface and is not
   * classified. Default true.
   */
  readonly ignorePrivateDeclarations?: boolean;
  readonly schemaLibraries?: readonly SchemaLibrary[];
  readonly reactComponentDetection?: { readonly enabled?: boolean };
  readonly hookDetection?: { readonly enabled?: boolean; readonly namePattern?: string };
}

export interface NormalizedOptions {
  readonly allow: readonly (readonly SemanticCategory[])[];
  readonly enumCategory: EnumCategory;
  readonly debug: boolean;
  readonly ignoreAmbientDeclarations: boolean;
  readonly ignorePrivateDeclarations: boolean;
  readonly schemaLibraries: readonly SchemaLibrary[];
  readonly reactComponentDetection: { readonly enabled: boolean };
  readonly hookDetection: { readonly enabled: boolean; readonly namePattern: RegExp };
}

export const DEFAULT_HOOK_NAME_PATTERN = '^use[A-Z0-9].*';

export const DEFAULT_OPTIONS: Required<SingleSemanticModuleOptions> = {
  allow: [],
  enumCategory: 'enum',
  debug: false,
  ignoreAmbientDeclarations: false,
  ignorePrivateDeclarations: true,
  schemaLibraries: SCHEMA_LIBRARIES,
  reactComponentDetection: { enabled: true },
  hookDetection: { enabled: true, namePattern: DEFAULT_HOOK_NAME_PATTERN },
};

export function normalizeOptions(options: SingleSemanticModuleOptions): NormalizedOptions {
  return {
    allow: options.allow ?? DEFAULT_OPTIONS.allow,
    enumCategory: options.enumCategory ?? DEFAULT_OPTIONS.enumCategory,
    debug: options.debug ?? DEFAULT_OPTIONS.debug,
    ignoreAmbientDeclarations:
      options.ignoreAmbientDeclarations ?? DEFAULT_OPTIONS.ignoreAmbientDeclarations,
    ignorePrivateDeclarations:
      options.ignorePrivateDeclarations ?? DEFAULT_OPTIONS.ignorePrivateDeclarations,
    schemaLibraries: options.schemaLibraries ?? DEFAULT_OPTIONS.schemaLibraries,
    reactComponentDetection: { enabled: options.reactComponentDetection?.enabled ?? true },
    hookDetection: {
      enabled: options.hookDetection?.enabled ?? true,
      namePattern: compilePattern(options.hookDetection?.namePattern ?? DEFAULT_HOOK_NAME_PATTERN),
    },
  };
}

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error: unknown) {
    throw new Error(
      `single-semantic-module: hookDetection.namePattern ${JSON.stringify(pattern)} is not a valid regular expression (${String(error)}).`,
    );
  }
}

/** True when the detected categories are one, or all fit inside one `allow` group. */
export function isCategorySetAllowed(
  categories: ReadonlySet<SemanticCategory>,
  allow: readonly (readonly SemanticCategory[])[],
): boolean {
  if (categories.size <= 1) {
    return true;
  }
  const detected = [...categories];
  return allow.some((group) => {
    const allowed = new Set(group);
    return detected.every((category) => allowed.has(category));
  });
}
