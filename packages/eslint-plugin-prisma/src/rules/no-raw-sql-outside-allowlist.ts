import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { DEFAULT_SYSTEM_FILES, isAllowlisted } from '../utils/allowlist';

const RULE_NAME = 'no-raw-sql-outside-allowlist';

export interface NoRawSqlOutsideAllowlistOptions {
  /** Globs of files allowed to run raw SQL that touches a table. */
  readonly allowedFiles?: readonly string[];
  /** SQL keywords (whole word, any case) that mark a literal chunk as table-touching. */
  readonly tableKeywords?: readonly string[];
}

type RuleOptions = [NoRawSqlOutsideAllowlistOptions];
type MessageIds = 'rawSqlTouchesTable' | 'rawSqlUnreadable' | 'rawSqlUnsafe';

/*
 * Raw SQL is the third escape hatch past a tenant boundary, next to the
 * unscoped client and "run without scope" helpers (see
 * no-unscoped-prisma-outside-allowlist). A tenant-scope `$extends` extension
 * dispatches on `model`, and a raw query has none, so it passes through
 * unscoped: the extension cannot parse SQL, so this door can only be guarded
 * statically.
 *
 *   - `$queryRaw` / `$executeRaw` as a TAGGED TEMPLATE are allowed anywhere
 *     when no literal chunk names a table-touching keyword. That is the
 *     "touches no table" carve-out: a boot probe (`SELECT 1`) and advisory
 *     locks (`SELECT pg_advisory_xact_lock(...)`) pass it. Only the literal
 *     chunks are read; interpolated values are bound parameters and cannot add
 *     SQL text, except `Prisma.raw` / `Prisma.sql` / `Prisma.join` fragments,
 *     whose text is not visible here, so those count as unreadable.
 *   - `$queryRaw` / `$executeRaw` in CALL form (`$queryRaw(Prisma.sql...)`),
 *     `$queryRawTyped`, and any other use (a bare reference, a destructure)
 *     are reported unless the file is allowlisted: the SQL text cannot be read
 *     at the call site.
 *   - `$queryRawUnsafe` / `$executeRawUnsafe` are ALWAYS reported, allowlist or
 *     not. They take a string, so they are an injection sink as well as a
 *     tenant escape.
 *
 * The carve-out is a floor, not a proof: a tableless statement can still call
 * a SQL function that reads a table. That is a reviewed-code problem; the rule
 * exists so the obvious `SELECT ... FROM "Invoice"` cannot land silently.
 *
 * The rule keys on Prisma's `$`-prefixed raw method names, not on the
 * receiver, so it needs no receiver options: nothing else spells `$queryRaw`.
 */
const DEFAULT_ALLOWED_FILES: readonly string[] = DEFAULT_SYSTEM_FILES;

/*
 * A literal chunk naming any of these (as a whole word, any case) may read or
 * write a table. The advisory lock survives because `\b` treats `_` as a word
 * character, so `pg_advisory_xact_lock` never matches `LOCK`.
 */
const DEFAULT_TABLE_KEYWORDS: readonly string[] = [
  'FROM',
  'INTO',
  'UPDATE',
  'JOIN',
  'TABLE',
  'DELETE',
  'MERGE',
  'COPY',
  'TRUNCATE',
  'LOCK',
  'ALTER',
  'DROP',
];

const TEMPLATE_METHODS = new Set(['$queryRaw', '$executeRaw']);
const TYPED_METHODS = new Set(['$queryRawTyped']);
const UNSAFE_METHODS = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);

/** `Prisma.<name>` helpers that splice SQL text the rule cannot see. */
const OPAQUE_FRAGMENT_HELPERS = new Set(['raw', 'sql', 'join']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    tableKeywords: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** The raw-method name a node refers to, whether as `x.$queryRaw` or as a destructured key. */
function rawMethodName(node: TSESTree.Node): string | null {
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    return node.property.name;
  }
  return null;
}

function isRawMethod(name: string): boolean {
  return TEMPLATE_METHODS.has(name) || TYPED_METHODS.has(name) || UNSAFE_METHODS.has(name);
}

/** True for `Prisma.raw(...)`, `Prisma.join(...)` or a `Prisma.sql\`...\`` fragment. */
function isOpaqueFragment(node: TSESTree.Expression): boolean {
  const target =
    node.type === AST_NODE_TYPES.CallExpression
      ? node.callee
      : node.type === AST_NODE_TYPES.TaggedTemplateExpression
        ? node.tag
        : null;
  return (
    target !== null &&
    target.type === AST_NODE_TYPES.MemberExpression &&
    !target.computed &&
    target.property.type === AST_NODE_TYPES.Identifier &&
    OPAQUE_FRAGMENT_HELPERS.has(target.property.name)
  );
}

export const noRawSqlOutsideAllowlistRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw Prisma SQL ($queryRaw, $executeRaw, $queryRawTyped, *Unsafe) that can touch a table outside an allowlist. A raw query has no model, so a tenant-scope extension passes it through unscoped.',
    },
    schema: [optionSchema],
    messages: {
      rawSqlTouchesTable:
        'Raw SQL naming `{{keyword}}` is not tenant-scoped: a tenant-scope extension passes a raw query through untouched, so this reads or writes every tenant. Use a model query through the scoped client, or add a reviewed allowlist entry.',
      rawSqlUnreadable:
        '`{{method}}` here is not tenant-scoped and its SQL text cannot be read at the call site. Use a tagged template whose text touches no table, a model query through the scoped client, or add a reviewed allowlist entry.',
      rawSqlUnsafe:
        '`{{method}}` is never allowed: it takes a string (an injection sink) and is not tenant-scoped. Use a model query, or a `$queryRaw` tagged template with bound parameters.',
    },
  },
  defaultOptions: [
    {
      allowedFiles: [...DEFAULT_ALLOWED_FILES],
      tableKeywords: [...DEFAULT_TABLE_KEYWORDS],
    },
  ],
  create(context, [options]) {
    const allowlisted = isAllowlisted(
      context.filename,
      options.allowedFiles ?? DEFAULT_ALLOWED_FILES,
    );
    const keywords = options.tableKeywords ?? DEFAULT_TABLE_KEYWORDS;
    // Keywords are escaped so a configured entry is always a literal word, and
    // an empty list matches nothing rather than every chunk.
    const keywordPattern =
      keywords.length === 0
        ? null
        : new RegExp(`\\b(${keywords.map(escapeRegExp).join('|')})\\b`, 'iu');

    function report(node: TSESTree.Node, method: string): void {
      if (UNSAFE_METHODS.has(method)) {
        context.report({ node, messageId: 'rawSqlUnsafe', data: { method } });
        return;
      }
      if (!allowlisted) {
        context.report({ node, messageId: 'rawSqlUnreadable', data: { method } });
      }
    }

    function checkTaggedTemplate(node: TSESTree.TaggedTemplateExpression, method: string): void {
      if (allowlisted) {
        return;
      }
      if (node.quasi.expressions.some((expression) => isOpaqueFragment(expression))) {
        context.report({ node, messageId: 'rawSqlUnreadable', data: { method } });
        return;
      }
      for (const quasi of node.quasi.quasis) {
        const match = keywordPattern?.exec(quasi.value.cooked ?? quasi.value.raw);
        if (match) {
          context.report({
            node,
            messageId: 'rawSqlTouchesTable',
            data: { keyword: (match[1] ?? '').toUpperCase() },
          });
          return;
        }
      }
    }

    return {
      MemberExpression(node): void {
        const method = rawMethodName(node);
        if (method === null || !isRawMethod(method)) {
          return;
        }
        const parent = node.parent;
        if (
          TEMPLATE_METHODS.has(method) &&
          parent.type === AST_NODE_TYPES.TaggedTemplateExpression &&
          parent.tag === node
        ) {
          checkTaggedTemplate(parent, method);
          return;
        }
        // Call form, $queryRawTyped, the *Unsafe variants, or a bare reference
        // that escapes to be called elsewhere: the SQL text is not readable here.
        report(node, method);
      },
      // `const { $queryRaw } = tx` pulls a raw method into a local binding, which
      // the member matcher above never sees again. Flag the destructure itself.
      VariableDeclarator(node): void {
        if (node.id.type !== AST_NODE_TYPES.ObjectPattern) {
          return;
        }
        for (const property of node.id.properties) {
          if (
            property.type === AST_NODE_TYPES.Property &&
            !property.computed &&
            property.key.type === AST_NODE_TYPES.Identifier &&
            isRawMethod(property.key.name)
          ) {
            report(property, property.key.name);
          }
        }
      },
    };
  },
});
