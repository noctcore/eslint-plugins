import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

export const RULE_NAME = 'zod-field-describe';

export interface ZodFieldDescribeOptions {
  /** Names the zod namespace is imported under. */
  readonly zodIdentifiers?: readonly string[];
  /** Leave a field whose value is another schema (`user: UserSchema`) to that schema's own description. */
  readonly allowSchemaReferences?: boolean;
}

type RuleOptions = [ZodFieldDescribeOptions];
type MessageIds = 'missingDescription';

/*
 * WHY THIS RULE EXISTS.
 *
 * A zod field description is the one piece of documentation that travels with
 * the schema: it becomes the `description` of the JSON Schema a schema-to-docs
 * or tool-definition generator emits, the hint an LLM sees for a tool
 * argument, and the text an API reference shows next to the field. A field
 * without one is silent in all three, and nothing fails at runtime to say so.
 *
 * The check is per property and purely syntactic: the value's method chain
 * must hold a `.describe('...')` with non-empty text, or a `.meta({ description })`.
 * A `.describe()` on the enclosing object does not cover its properties.
 *
 * It ships opt-in because it is a documentation convention, not a defect.
 * Scoping it to schema modules is the consuming config's `files`, as for the
 * other zod rules; the rule itself assumes no layout.
 */

/** Object constructors whose first argument is the shape. */
const OBJECT_FACTORIES: ReadonlySet<string> = new Set(['object', 'strictObject', 'looseObject']);

/** Methods that add fields to an existing object schema. */
const SHAPE_EXTENDERS: ReadonlySet<string> = new Set(['extend', 'safeExtend']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    zodIdentifiers: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description: 'Names the zod namespace is imported under.',
    },
    allowSchemaReferences: {
      type: 'boolean',
      description:
        'Do not report a field whose value is a reference to another schema (`user: UserSchema`, `user: Schemas.User.optional()`); that schema carries its own description. Default true.',
    },
  },
};

/** `obj.name(...)`, with the receiver and the method name, or null. */
function methodCall(
  node: TSESTree.Node,
): { receiver: TSESTree.Expression; method: string; call: TSESTree.CallExpression } | null {
  if (node.type !== AST_NODE_TYPES.CallExpression) return null;
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) return null;
  if (callee.property.type !== AST_NODE_TYPES.Identifier) return null;
  return { receiver: callee.object, method: callee.property.name, call: node };
}

/** The text of a static string argument, or null when it is computed. */
function staticText(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') return node.value;
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** A description argument counts unless it is statically empty; a computed one is trusted. */
function isNonEmptyText(node: TSESTree.Node): boolean {
  const text = staticText(node);
  return text === null || text.trim() !== '';
}

/** `{ description: '...' }`, or an object whose spread may supply one. */
function metaHasDescription(arg: TSESTree.CallExpressionArgument | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.type !== AST_NODE_TYPES.ObjectExpression) return true;
  for (const property of arg.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) return true;
    if (property.computed) continue;
    const key = property.key;
    const isDescription =
      (key.type === AST_NODE_TYPES.Identifier && key.name === 'description') ||
      (key.type === AST_NODE_TYPES.Literal && key.value === 'description');
    if (isDescription) return isNonEmptyText(property.value);
  }
  return false;
}

/** The field name of a non-computed property, or null. */
function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

export const zodFieldDescribeRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require every property of a zod object schema to carry a non-empty `.describe()` or `.meta({ description })`, so generated JSON Schema, tool definitions and API docs have text for each field.',
    },
    schema: [optionSchema],
    messages: {
      missingDescription:
        '`{{field}}` has no description. Add `.describe(\'...\')` or `.meta({ description: \'...\' })` to its schema so generated docs and tool definitions can explain it.',
    },
  },
  defaultOptions: [{ zodIdentifiers: ['z'], allowSchemaReferences: true }],
  create(context, [options]) {
    const zodIdentifiers = new Set(options.zodIdentifiers ?? ['z']);
    const allowSchemaReferences = options.allowSchemaReferences ?? true;
    const sourceCode = context.sourceCode;

    function isZodNamespace(node: TSESTree.Node): boolean {
      return node.type === AST_NODE_TYPES.Identifier && zodIdentifiers.has(node.name);
    }

    /** `z.<name>(...)` on a configured zod namespace. */
    function isZodObjectFactory(node: TSESTree.Node): boolean {
      const call = methodCall(node);
      return call !== null && isZodNamespace(call.receiver) && OBJECT_FACTORIES.has(call.method);
    }

    /**
     * Walks a field's method chain from the outside in. Reports whether any
     * link describes the field, and what the chain is rooted at: a zod
     * factory, a reference to another schema, or something else.
     */
    function inspectChain(value: TSESTree.Node): {
      described: boolean;
      root: 'factory' | 'reference' | 'other';
    } {
      let described = false;
      let current: TSESTree.Node = value;
      for (;;) {
        const call = methodCall(current);
        if (call === null) {
          if (current.type === AST_NODE_TYPES.Identifier) {
            return { described, root: isZodNamespace(current) ? 'other' : 'reference' };
          }
          if (current.type === AST_NODE_TYPES.MemberExpression) {
            return { described, root: isZodNamespace(current.object) ? 'other' : 'reference' };
          }
          return { described, root: 'other' };
        }
        if (isZodNamespace(call.receiver)) return { described, root: 'factory' };
        if (call.method === 'describe') {
          const arg = call.call.arguments[0];
          if (arg !== undefined && isNonEmptyText(arg)) described = true;
        } else if (call.method === 'meta' && metaHasDescription(call.call.arguments[0])) {
          described = true;
        }
        current = call.receiver;
      }
    }

    function checkShape(shape: TSESTree.Node | undefined): void {
      if (shape?.type !== AST_NODE_TYPES.ObjectExpression) return;
      for (const property of shape.properties) {
        if (property.type !== AST_NODE_TYPES.Property) continue;
        const { described, root } = inspectChain(property.value);
        if (described || root === 'other') continue;
        if (root === 'reference' && allowSchemaReferences) continue;
        context.report({
          node: property,
          messageId: 'missingDescription',
          data: { field: propertyName(property) ?? sourceCode.getText(property.key) },
        });
      }
    }

    return {
      CallExpression(node): void {
        if (isZodObjectFactory(node)) {
          checkShape(node.arguments[0]);
          return;
        }
        const call = methodCall(node);
        if (call !== null && SHAPE_EXTENDERS.has(call.method)) checkShape(node.arguments[0]);
      },
    };
  },
});
