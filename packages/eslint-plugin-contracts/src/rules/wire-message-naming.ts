import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'wire-message-naming';

export interface WireMessageNamingOptions {
  readonly roleSuffixes?: readonly string[];
}

type RuleOptions = [WireMessageNamingOptions];
type MessageIds = 'typeMismatch';

/*
 * Role suffixes that mark a schema as a wire message. A const named
 * `<Name><RoleSuffix>` whose zod object declares `type: z.literal(...)` must set
 * that literal to kebab-case(Name). Parameterized so consumers can use their own
 * message taxonomy (default: the Event/Command/Query CQRS trio).
 */
const DEFAULT_ROLE_SUFFIXES: readonly string[] = ['Event', 'Command', 'Query'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    roleSuffixes: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
  },
};

/** PascalCase -> kebab-case (handles acronym runs: `RunHTTPTask` -> `run-http-task`). */
function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function roleSuffix(name: string, suffixes: readonly string[]): string | null {
  return suffixes.find((s) => name.endsWith(s) && name.length > s.length) ?? null;
}

/** Unwrap a zod builder chain (`z.object({...}).strict()`) to its first ObjectExpression arg. */
function unwrapToObject(node: TSESTree.Expression): TSESTree.ObjectExpression | null {
  let cur: TSESTree.Node | null = node;
  while (cur && cur.type === 'CallExpression') {
    const objArg = cur.arguments.find((a) => a.type === 'ObjectExpression');
    if (objArg && objArg.type === 'ObjectExpression') return objArg;
    cur = cur.callee.type === 'MemberExpression' ? cur.callee.object : null;
  }
  return null;
}

/** Find the `type: z.literal('x')` property and return its string-literal arg node. */
function typeLiteralNode(obj: TSESTree.ObjectExpression): TSESTree.Literal | null {
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue;
    const isType =
      (p.key.type === 'Identifier' && p.key.name === 'type') ||
      (p.key.type === 'Literal' && p.key.value === 'type');
    if (!isType) continue;
    const v = p.value;
    if (
      v.type === 'CallExpression' &&
      v.callee.type === 'MemberExpression' &&
      v.callee.property.type === 'Identifier' &&
      v.callee.property.name === 'literal'
    ) {
      const arg = v.arguments[0];
      if (arg && arg.type === 'Literal' && typeof arg.value === 'string') return arg;
    }
  }
  return null;
}

export const wireMessageNamingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A message-schema const ending in a role suffix (default Event/Command/Query) whose zod object declares `type: z.literal(...)` must set that literal to kebab-case(const name minus its role suffix).',
    },
    fixable: 'code',
    schema: [optionSchema],
    messages: {
      typeMismatch:
        "Wire `type` literal '{{actual}}' for `{{name}}` must be '{{expected}}' — kebab-case of the const name minus its role suffix.",
    },
  },
  defaultOptions: [{ roleSuffixes: ['Event', 'Command', 'Query'] }],
  create(context, [options]) {
    const roleSuffixes = options.roleSuffixes ?? DEFAULT_ROLE_SUFFIXES;

    return {
      ExportNamedDeclaration(node): void {
        const decl = node.declaration;
        if (!decl || decl.type !== 'VariableDeclaration') return;
        for (const d of decl.declarations) {
          if (d.id.type !== 'Identifier' || !d.init) continue;
          const suffix = roleSuffix(d.id.name, roleSuffixes);
          if (!suffix) continue;
          const obj = unwrapToObject(d.init);
          if (!obj) continue;
          const lit = typeLiteralNode(obj);
          if (!lit) continue;
          const expected = kebab(d.id.name.slice(0, -suffix.length));
          if (lit.value !== expected) {
            context.report({
              node: lit,
              messageId: 'typeMismatch',
              data: { name: d.id.name, actual: String(lit.value), expected },
              fix: (fixer) => fixer.replaceText(lit, `'${expected}'`),
            });
          }
        }
      },
    };
  },
});
