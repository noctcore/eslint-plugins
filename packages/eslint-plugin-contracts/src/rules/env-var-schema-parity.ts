import path from 'node:path';

import { createFileCache } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'env-var-schema-parity';

export interface EnvVarSchemaParityOptions {
  /** Path to the env declaration source — a `.env.example` or a zod-env module. Empty = rule is inert. */
  readonly schema?: string;
}

type RuleOptions = [EnvVarSchemaParityOptions];
type MessageIds = 'undeclaredEnvVar';

/*
 * `process.env.FOO` / `import.meta.env.FOO` accessed for a key that no schema
 * declares is a config drift waiting to fail in production — the variable is
 * read but nothing documents, validates, or provisions it. This rule cross-
 * checks each static env access against a declared key set read from a schema
 * file.
 *
 * INERT UNTIL CONFIGURED: with no `schema` path the rule reports nothing. The
 * schema is read once per resolved path and cached for the process. The parser
 * is intentionally format-agnostic and PERMISSIVE — it unions dotenv keys
 * (`FOO=...`) with object-property keys (`FOO: z.string()`, `'FOO': ...`) so it
 * accepts both a `.env.example` and a zod-env module, and over-collection only
 * ever suppresses a report (never invents one). If the schema cannot be read the
 * rule goes inert rather than flagging every access.
 *
 * Only STATIC accesses are policed: `process.env.FOO`, `import.meta.env.FOO`,
 * and the keys of a destructure (`const { FOO } = process.env`). Computed
 * access (`process.env[dynamic]`) and a rest element are left alone.
 *
 * Keys the runtime defines are never reported: Vite's `MODE`, `DEV`, `PROD`,
 * `SSR` and `BASE_URL`, and `NODE_ENV`.
 *
 * The schema is re-read when its mtime moves, so an editor session sees a key
 * added to `.env.example` without restarting the ESLint server.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', minLength: 1 },
  },
};

const BUILTIN_KEYS: ReadonlySet<string> = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'NODE_ENV']);

// Resolved schema path -> declared key set, re-read when the mtime moves (unreadable = rule stays inert).
const schemaCache = createFileCache((text) => parseDeclaredKeys(text));

const DOTENV_KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm;
const OBJECT_KEY = /["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s*:/g;

/** Union of dotenv keys and object-property keys found in the schema source. */
function parseDeclaredKeys(source: string): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(DOTENV_KEY)) {
    if (match[1]) keys.add(match[1]);
  }
  for (const match of source.matchAll(OBJECT_KEY)) {
    if (match[1]) keys.add(match[1]);
  }
  return keys;
}

/** Read + cache the declared key set for a schema path; null when unreadable. */
function loadSchema(cwd: string, schema: string): ReadonlySet<string> | null {
  const resolved = path.isAbsolute(schema) ? schema : path.resolve(cwd, schema);
  return schemaCache.get(resolved) ?? null;
}

/** `process.env` member expression. */
function isProcessEnv(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.object.type === AST_NODE_TYPES.Identifier &&
    node.object.name === 'process' &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'env'
  );
}

/** `import.meta.env` member expression (`import.meta` is a MetaProperty). */
function isImportMetaEnv(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'env' &&
    node.object.type === AST_NODE_TYPES.MetaProperty &&
    node.object.meta.name === 'import' &&
    node.object.property.name === 'meta'
  );
}

export const envVarSchemaParityRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require every `process.env.FOO` / `import.meta.env.FOO` key to be declared in a schema file (`.env.example` or a zod-env module), so config access and config declaration cannot drift apart.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      undeclaredEnvVar:
        'Env var `{{name}}` is read here but not declared in `{{schema}}`. Add it to the schema (or fix the typo) so config stays a validated contract.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const schema = options.schema;
    if (!schema) {
      return {};
    }
    const declared = loadSchema(context.cwd, schema);
    if (declared === null) {
      return {};
    }

    function checkName(node: TSESTree.Node, name: string): void {
      if (!BUILTIN_KEYS.has(name) && !declared!.has(name)) {
        context.report({ node, messageId: 'undeclaredEnvVar', data: { name, schema } });
      }
    }

    return {
      MemberExpression(node): void {
        // `<env>.FOO` where the object is `process.env` or `import.meta.env`.
        if (
          (isProcessEnv(node.object) || isImportMetaEnv(node.object)) &&
          !node.computed &&
          node.property.type === AST_NODE_TYPES.Identifier
        ) {
          checkName(node.property, node.property.name);
        }
      },
      // `const { FOO, BAR: bar } = process.env`.
      VariableDeclarator(node): void {
        if (node.id.type !== AST_NODE_TYPES.ObjectPattern || node.init === null) {
          return;
        }
        if (!isProcessEnv(node.init) && !isImportMetaEnv(node.init)) {
          return;
        }
        for (const property of node.id.properties) {
          if (property.type === AST_NODE_TYPES.Property && !property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
            checkName(property.key, property.key.name);
          }
        }
      },
    };
  },
});
