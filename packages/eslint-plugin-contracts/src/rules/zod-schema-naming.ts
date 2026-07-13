import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'zod-schema-naming';

export interface ZodSchemaNamingOptions {
  readonly roleSuffixes?: readonly string[];
}

type RuleOptions = [ZodSchemaNamingOptions];
type MessageIds = 'schemaNaming' | 'missingType';

const SCHEMA_NAME = /^[A-Z][A-Za-z0-9]*Schema$/;
const SUFFIX = 'Schema';

/*
 * Role-suffix carve-out. Some schemas intentionally carry a role suffix
 * (`SessionStartedEvent`, `RunTaskCommand`, `ListSessionsQuery`) instead of
 * `Schema` — their const-name → wire-discriminant contract is enforced by
 * `wire-message-naming`, so they should be exempt from the `*Schema` naming
 * rule. This is a PROJECT convention, not a universal one, so it is an option:
 * the default is an empty list, which applies the base `*Schema` convention
 * cleanly (a role-suffixed export is then flagged like any other). Codebases
 * that use the Event/Command/Query pattern pass those suffixes to opt in.
 */
const DEFAULT_ROLE_SUFFIXES: readonly string[] = [];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    roleSuffixes: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

function hasRoleSuffix(name: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => name.endsWith(s) && name.length > s.length);
}

/*
 * Walk an expression down its call/member chain to the root identifier so
 * `z.object({...})`, `z.union([...])`, `z.string().min(1)` etc. all resolve to
 * the root `z`. Anything not rooted at `z` is not treated as a zod schema.
 */
function rootIdentifierName(node: TSESTree.Node | null | undefined): string | null {
  let current: TSESTree.Node | null | undefined = node;
  while (current) {
    switch (current.type) {
      case 'CallExpression':
        current = current.callee;
        break;
      case 'MemberExpression':
        current = current.object;
        break;
      case 'Identifier':
        return current.name;
      default:
        return null;
    }
  }
  return null;
}

export const zodSchemaNamingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every exported zod schema is a PascalCase const suffixed `Schema`, paired with a same-named inferred type (`export type Foo = z.infer<typeof FooSchema>`).',
    },
    schema: [optionSchema],
    messages: {
      schemaNaming:
        'Exported zod schema `{{name}}` must be a PascalCase const ending in `Schema` (e.g. `FooSchema`).',
      missingType:
        'Schema `{{name}}` has no sibling `export type {{base}} = z.infer<typeof {{name}}>`. Export the inferred type instead of hand-authoring a duplicate.',
    },
  },
  defaultOptions: [{ roleSuffixes: [] }],
  create(context, [options]) {
    const roleSuffixes = options.roleSuffixes ?? DEFAULT_ROLE_SUFFIXES;
    const schemas: { node: TSESTree.Identifier; name: string }[] = [];
    const exportedTypes = new Set<string>();

    return {
      ExportNamedDeclaration(node): void {
        const decl = node.declaration;
        if (!decl) return;
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (
              d.id.type === 'Identifier' &&
              d.init &&
              rootIdentifierName(d.init) === 'z'
            ) {
              if (hasRoleSuffix(d.id.name, roleSuffixes)) continue;
              if (!SCHEMA_NAME.test(d.id.name)) {
                context.report({
                  node: d.id,
                  messageId: 'schemaNaming',
                  data: { name: d.id.name },
                });
              } else {
                schemas.push({ node: d.id, name: d.id.name });
              }
            }
          }
        } else if (
          decl.type === 'TSTypeAliasDeclaration' ||
          decl.type === 'TSInterfaceDeclaration'
        ) {
          exportedTypes.add(decl.id.name);
        }
      },
      'Program:exit'(): void {
        for (const schema of schemas) {
          const base = schema.name.slice(0, -SUFFIX.length);
          if (!exportedTypes.has(base)) {
            context.report({
              node: schema.node,
              messageId: 'missingType',
              data: { name: schema.name, base },
            });
          }
        }
      },
    };
  },
});
