import { readFileSync } from 'node:fs';
import path from 'node:path';

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
 * Only STATIC accesses are policed (`process.env.FOO`, `import.meta.env.FOO`).
 * Computed (`process.env[dynamic]`) and destructured reads are left alone.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', minLength: 1 },
  },
};

// Resolved schema path -> declared key set (null = unreadable, rule stays inert).
const schemaCache = new Map<string, ReadonlySet<string> | null>();

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
  const cached = schemaCache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }
  let keys: ReadonlySet<string> | null;
  try {
    keys = parseDeclaredKeys(readFileSync(resolved, 'utf8'));
  } catch {
    keys = null;
  }
  schemaCache.set(resolved, keys);
  return keys;
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

    function check(node: TSESTree.MemberExpression): void {
      if (node.computed || node.property.type !== AST_NODE_TYPES.Identifier) {
        return;
      }
      const name = node.property.name;
      if (!declared!.has(name)) {
        context.report({
          node: node.property,
          messageId: 'undeclaredEnvVar',
          data: { name, schema },
        });
      }
    }

    return {
      MemberExpression(node): void {
        // `<env>.FOO` where the object is `process.env` or `import.meta.env`.
        if (isProcessEnv(node.object) || isImportMetaEnv(node.object)) {
          check(node);
        }
      },
    };
  },
});
