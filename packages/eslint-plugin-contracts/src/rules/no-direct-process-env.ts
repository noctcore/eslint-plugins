import {
  allowInAliasDescription,
  fileMatchesAnyGlob,
  isStaticMemberAccess,
  resolveAllowIn,
} from "@noctcore/eslint-utils";
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import type { JSONSchema4 } from "@typescript-eslint/utils/json-schema";

import { createRule } from "../createRule";

const RULE_NAME = "no-direct-process-env";

export type EnvSource = "process.env" | "import.meta.env";

export interface NoDirectProcessEnvOptions {
  /** Import path of the typed config accessor consumers should read env through. */
  readonly configModule?: string;
  /** Glob allowlist of files permitted to read the policed sources directly (bootstrap, config, tests). */
  readonly allowIn?: readonly string[];
  /** Environment sources to police. Defaults to `['process.env']`. */
  readonly sources?: readonly EnvSource[];
  /** @deprecated Use `allowIn`. */
  readonly allowedFiles?: readonly string[];
}

type RuleOptions = [NoDirectProcessEnvOptions];
type MessageIds = "directProcessEnv";

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
const DEFAULT_CONFIG_MODULE = "@/config";

const ENV_SOURCES: readonly EnvSource[] = ["process.env", "import.meta.env"];

const DEFAULT_SOURCES: readonly EnvSource[] = ["process.env"];

// Build constants Vite injects under `import.meta.env`; they are not user configuration.
const VITE_BUILD_CONSTANTS: ReadonlySet<string> = new Set([
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "BASE_URL",
]);

// Config files and tests in every module flavour, and repo tooling (`scripts/`,
// `tools/`): a CLI's environment is its input, and it boots no app whose config
// module it could read through.
const DEFAULT_ALLOWED_FILES: readonly string[] = [
  "**/*.config.{ts,js,mjs,cjs,mts,cts}",
  "**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/scripts/**",
  "**/tools/**",
];

const optionSchema: JSONSchema4 = {
  type: "object",
  additionalProperties: false,
  properties: {
    configModule: {
      type: "string",
      minLength: 1,
      description:
        "Import path of the validated config module, named in the report message.",
    },
    allowIn: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
      description:
        "Globs of files that may read the policed sources directly. Replaces the default list.",
    },
    allowedFiles: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
      description: allowInAliasDescription("allowedFiles"),
    },
    sources: {
      type: "array",
      items: { type: "string", enum: [...ENV_SOURCES] },
      uniqueItems: true,
      minItems: 1,
      description:
        "Environment sources whose reads are reported: `process.env`, `import.meta.env`, or both. Defaults to `['process.env']`. Under `import.meta.env`, Vite's build constants (`MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`) are never reported.",
    },
  },
};

// Matches `import.meta.env` and `import.meta['env']`.
function isImportMetaEnv(node: TSESTree.MemberExpression): boolean {
  const { object, property } = node;
  if (
    object.type !== AST_NODE_TYPES.MetaProperty ||
    object.meta.name !== "import" ||
    object.property.name !== "meta"
  ) {
    return false;
  }
  if (node.computed) {
    return property.type === AST_NODE_TYPES.Literal && property.value === "env";
  }
  return property.type === AST_NODE_TYPES.Identifier && property.name === "env";
}

function envSourceOf(node: TSESTree.MemberExpression): EnvSource | null {
  if (isStaticMemberAccess(node, "process", "env")) {
    return "process.env";
  }
  return isImportMetaEnv(node) ? "import.meta.env" : null;
}

function isViteBuildConstantKey(
  key: TSESTree.Node,
  computed: boolean,
): boolean {
  if (!computed && key.type === AST_NODE_TYPES.Identifier) {
    return VITE_BUILD_CONSTANTS.has(key.name);
  }
  return (
    key.type === AST_NODE_TYPES.Literal &&
    typeof key.value === "string" &&
    VITE_BUILD_CONSTANTS.has(key.value)
  );
}

function isViteBuildConstantPattern(pattern: TSESTree.Node): boolean {
  return (
    pattern.type === AST_NODE_TYPES.ObjectPattern &&
    pattern.properties.length > 0 &&
    pattern.properties.every(
      (entry) =>
        entry.type === AST_NODE_TYPES.Property &&
        isViteBuildConstantKey(entry.key, entry.computed),
    )
  );
}

// True when the `import.meta.env` read only takes Vite build constants: a
// property read of one, or a destructure whose every key is one.
function readsOnlyViteBuildConstants(node: TSESTree.MemberExpression): boolean {
  const { parent } = node;
  if (parent.type === AST_NODE_TYPES.MemberExpression) {
    return (
      parent.object === node &&
      isViteBuildConstantKey(parent.property, parent.computed)
    );
  }
  if (parent.type === AST_NODE_TYPES.VariableDeclarator) {
    return parent.init === node && isViteBuildConstantPattern(parent.id);
  }
  if (parent.type === AST_NODE_TYPES.AssignmentExpression) {
    return parent.right === node && isViteBuildConstantPattern(parent.left);
  }
  return false;
}

export const noDirectProcessEnvRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct `process.env` access. Force every consumer through a typed, validated config accessor so a missing variable fails at boot, not at use.",
    },
    schema: [optionSchema],
    messages: {
      directProcessEnv:
        "Read environment variables through your validated config module (`{{configModule}}`); a direct `{{source}}` read skips the check at startup. A script or CLI whose environment is its input belongs in `allowIn`.",
    },
  },
  defaultOptions: [
    {
      configModule: DEFAULT_CONFIG_MODULE,
    },
  ],
  create(context, [options]) {
    const configModule = options.configModule ?? DEFAULT_CONFIG_MODULE;
    const sources: ReadonlySet<EnvSource> = new Set(
      options.sources ?? DEFAULT_SOURCES,
    );
    const allowedFiles = resolveAllowIn(
      options,
      ["allowedFiles"],
      DEFAULT_ALLOWED_FILES,
    );

    if (fileMatchesAnyGlob(context.filename, allowedFiles, context.cwd)) {
      return {};
    }

    return {
      /*
       * `process.env` and `import.meta.env` are themselves MemberExpressions, so
       * a single visitor on the node catches every usage position: property
       * access (`process.env.X`), computed access (`process.env[X]`),
       * destructuring (`const { X } = process.env`), and bare value usage where
       * it is passed as an argument, returned, or assigned (`log(process.env)`,
       * `return process.env`).
       */
      MemberExpression(node): void {
        const source = envSourceOf(node);
        if (source === null || !sources.has(source)) {
          return;
        }
        if (source === "import.meta.env" && readsOnlyViteBuildConstants(node)) {
          return;
        }
        context.report({
          node,
          messageId: "directProcessEnv",
          data: { configModule, source },
        });
      },
    };
  },
});
