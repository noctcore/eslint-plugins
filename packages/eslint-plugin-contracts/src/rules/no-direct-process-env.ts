import { allowInAliasDescription, fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-direct-process-env';

export interface NoDirectProcessEnvOptions {
  /** Import path of the typed config accessor consumers should read env through. */
  readonly configModule?: string;
  /** Glob allowlist of files permitted to read `process.env` directly (bootstrap, config, tests). */
  readonly allowIn?: readonly string[];
  /** @deprecated Use `allowIn`. */
  readonly allowedFiles?: readonly string[];
}

type RuleOptions = [NoDirectProcessEnvOptions];
type MessageIds = 'directProcessEnv';

/*
 * De-projected from BoringStack: the original resolved every file to a
 * pnpm-workspace root and matched allowlist globs with micromatch. That coupled
 * the rule to one repo layout and a runtime dependency. Here the allowlist is
 * matched against the (forward-slashed) filename with the shared eslint-utils
 * matcher, which compiles each glob once and caches it, with no repo-root
 * detection. Globs support `*`, `**`, `?`, and `{a,b}` alternation; a leading
 * `**\/` matches any (or no) directory prefix, so patterns work against both
 * relative and absolute filenames.
 */
const DEFAULT_CONFIG_MODULE = '@/config';

// Config files and tests in every module flavour, and repo tooling (`scripts/`,
// `tools/`): a CLI's environment is its input, and it boots no app whose config
// module it could read through.
const DEFAULT_ALLOWED_FILES: readonly string[] = [
  '**/*.config.{ts,js,mjs,cjs,mts,cts}',
  '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/scripts/**',
  '**/tools/**',
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    configModule: {
      type: 'string',
      minLength: 1,
      description: 'Import path of the validated config module, named in the report message.',
    },
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: 'Globs of files that may read `process.env` directly. Replaces the default list.',
    },
    allowedFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: allowInAliasDescription('allowedFiles'),
    },
  },
};

// Matches both `process.env` and `process['env']` so a computed access cannot
// bypass the rule.
function isProcessEnv(node: TSESTree.Node): boolean {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.object.type !== AST_NODE_TYPES.Identifier ||
    node.object.name !== 'process'
  ) {
    return false;
  }
  if (node.computed) {
    return node.property.type === AST_NODE_TYPES.Literal && node.property.value === 'env';
  }
  return node.property.type === AST_NODE_TYPES.Identifier && node.property.name === 'env';
}

export const noDirectProcessEnvRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct `process.env` access. Force every consumer through a typed, validated config accessor so a missing variable fails at boot, not at use.',
    },
    schema: [optionSchema],
    messages: {
      directProcessEnv:
        'Read environment variables through your validated config module (`{{configModule}}`); a direct `process.env` read skips the check at startup. A script or CLI whose environment is its input belongs in `allowIn`.',
    },
  },
  defaultOptions: [
    {
      configModule: DEFAULT_CONFIG_MODULE,
    },
  ],
  create(context, [options]) {
    const configModule = options.configModule ?? DEFAULT_CONFIG_MODULE;
    const allowedFiles = resolveAllowIn(options, ['allowedFiles'], DEFAULT_ALLOWED_FILES);

    if (fileMatchesAnyGlob(context.filename, allowedFiles, context.cwd)) {
      return {};
    }

    return {
      /*
       * `process.env` is itself a MemberExpression, so a single visitor on the
       * node catches every usage position: property access (`process.env.X`),
       * computed access (`process.env[X]`), destructuring (`const { X } =
       * process.env`), and bare value usage where it is passed as an argument,
       * returned, or assigned (`log(process.env)`, `return process.env`).
       */
      MemberExpression(node): void {
        if (isProcessEnv(node)) {
          context.report({ node, messageId: 'directProcessEnv', data: { configModule } });
        }
      },
    };
  },
});
