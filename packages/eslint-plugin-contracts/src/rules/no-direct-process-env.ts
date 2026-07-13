import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-direct-process-env';

export interface NoDirectProcessEnvOptions {
  /** Import path of the typed config accessor consumers should read env through. */
  readonly configModule?: string;
  /** Glob allowlist of files permitted to read `process.env` directly (bootstrap, config, tests). */
  readonly allowedFiles?: readonly string[];
}

type RuleOptions = [NoDirectProcessEnvOptions];
type MessageIds = 'directProcessEnv';

/*
 * De-projected from BoringStack: the original resolved every file to a
 * pnpm-workspace root and matched allowlist globs with micromatch. That coupled
 * the rule to one repo layout and a runtime dependency. Here the allowlist is
 * matched against the (forward-slashed) filename with a small self-contained
 * glob matcher — no repo-root detection, no external dependency — so the rule is
 * portable. Globs support `*`, `**`, `?`, and `{a,b}` alternation; a leading
 * `**\/` matches any (or no) directory prefix, so patterns work against both
 * relative and absolute filenames.
 */
const DEFAULT_CONFIG_MODULE = '@/config';

const DEFAULT_ALLOWED_FILES: readonly string[] = [
  '**/*.config.{ts,js,mjs,cjs}',
  '**/*.{spec,test}.{ts,tsx}',
  '**/scripts/**',
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    configModule: { type: 'string', minLength: 1 },
    allowedFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

/** Compile a glob (with `*`, `**`, `?`, `{a,b}`) to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume the second `*`
        if (glob[i + 1] === '/') {
          i++; // consume the slash: `**/` matches zero or more leading dirs
          re += '(?:.*/)?';
        } else {
          re += '.*'; // `**` matches anything, including path separators
        }
      } else {
        re += '[^/]*'; // `*` stays within a path segment
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      re += '(?:';
      braceDepth++;
    } else if (c === '}') {
      re += ')';
      if (braceDepth > 0) braceDepth--;
    } else if (c === ',') {
      re += braceDepth > 0 ? '|' : '\\,';
    } else if ('.+^$()|[]\\/'.includes(c as string)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when the file is covered by one of the allowlist globs. Empty list allowlists nothing. */
function isAllowedFile(filename: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = filename.split('\\').join('/');
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

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
        'Read environment variables through your typed config accessor (import from `{{configModule}}`). Direct `process.env` access bypasses boot-time validation.',
    },
  },
  defaultOptions: [
    {
      configModule: DEFAULT_CONFIG_MODULE,
      allowedFiles: [...DEFAULT_ALLOWED_FILES],
    },
  ],
  create(context, [options]) {
    const configModule = options.configModule ?? DEFAULT_CONFIG_MODULE;
    const allowedFiles = options.allowedFiles ?? DEFAULT_ALLOWED_FILES;

    if (isAllowedFile(context.filename, allowedFiles)) {
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
