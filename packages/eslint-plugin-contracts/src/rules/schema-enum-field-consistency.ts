import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

export const RULE_NAME = 'schema-enum-field-consistency';

export interface SchemaEnumFieldConsistencyOptions {
  /** Names the zod namespace is imported under. */
  readonly zodIdentifiers?: readonly string[];
  /** Field names allowed to be an enum in one schema and a string in another. */
  readonly ignoreFields?: readonly string[];
  /**
   * Regex source. An IMPORTED identifier counts as an enum only when its name
   * matches. Unset, no imported identifier does.
   */
  readonly enumIdentifierPattern?: string;
}

type RuleOptions = [SchemaEnumFieldConsistencyOptions];
type MessageIds = 'widenedEnumField';

/*
 * WHY THIS RULE EXISTS.
 *
 * In tRPC (and any contract package whose schemas double as wire types) the
 * output schema IS the type the client imports. When a field is `statusSchema`
 * on the create and update inputs but `z.string()` on the item output, the
 * widening is invisible to the compiler and to review: both schemas are
 * individually correct. The cost lands on every consumer, which then narrows
 * by hand or casts (a `safeParse` fallback in a form, an `as Status | null` in
 * a service), and each new consumer is one more place to get it wrong.
 *
 * The rule is per file and purely syntactic, so it needs no type information:
 * a field name that is an enum in one `z.object` of the module must not be a
 * `z.string()` in another. It has no autofix on purpose: the right fix may be a
 * data migration (the stored column was free text), not a schema edit.
 *
 * Nothing here knows a project layout. The zod namespace, the imported-enum
 * naming convention and the per-field escape hatch are options; scoping to a
 * schema folder is the consuming config's `files`.
 *
 * Provenance: upstreamed from Settly's `eslint-plugin-repo` (the owner's own
 * code), where it guarded a widened output field that shipped in a shared
 * schema module.
 */

/** Chain links that leave the field's value set unchanged. */
const MODIFIERS: ReadonlySet<string> = new Set([
  'optional',
  'nullable',
  'nullish',
  'default',
  'prefault',
  'catch',
  'describe',
  'meta',
  'readonly',
]);

/** Enum methods that return a (narrower or wider) enum. */
const ENUM_PRESERVING: ReadonlySet<string> = new Set(['extract', 'exclude']);

/** Links that change what the schema outputs, so a string root stops counting. */
const OUTPUT_CHANGING: ReadonlySet<string> = new Set(['pipe', 'transform']);

/** Object constructors whose first argument is the shape. */
const OBJECT_FACTORIES: ReadonlySet<string> = new Set(['object', 'strictObject', 'looseObject']);

/** Methods that add fields to an existing object schema. */
const SHAPE_EXTENDERS: ReadonlySet<string> = new Set(['extend', 'safeExtend']);

const ENUM_FACTORIES: ReadonlySet<string> = new Set(['enum', 'nativeEnum']);
const UNION: ReadonlySet<string> = new Set(['union']);
const LITERAL: ReadonlySet<string> = new Set(['literal']);
const STRING: ReadonlySet<string> = new Set(['string']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    zodIdentifiers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    ignoreFields: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    enumIdentifierPattern: { type: 'string' },
  },
};

interface IEnumKind {
  readonly kind: 'enum';
  /** The enum schema's identifier when the field names one, for the suggestion. */
  readonly identifier: string | null;
}

type FieldKind = IEnumKind | { readonly kind: 'string' } | { readonly kind: 'other' };

const OTHER: FieldKind = { kind: 'other' };

interface IFieldOccurrence<K extends FieldKind = FieldKind> {
  readonly property: TSESTree.Property;
  readonly kind: K;
}

function isEnumOccurrence(occurrence: IFieldOccurrence): occurrence is IFieldOccurrence<IEnumKind> {
  return occurrence.kind.kind === 'enum';
}

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

/** The field name of a non-computed property, or null. */
function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

export const schemaEnumFieldConsistencyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a zod field that is an enum in one object schema of a module from being `z.string()` in another, which widens the wire type every consumer then narrows by hand.',
    },
    schema: [optionSchema],
    messages: {
      widenedEnumField:
        '`{{field}}` is `z.string()` here but an enum on line {{line}} of this file. The widened type leaks `string` to every consumer, which then has to narrow or cast it. Use {{suggestion}} instead (and, if the stored data is free text, migrate it first).',
    },
  },
  defaultOptions: [{ zodIdentifiers: ['z'], ignoreFields: [] }],
  create(context, [options]) {
    const zodIdentifiers = new Set(options.zodIdentifiers ?? ['z']);
    const ignoreFields = new Set(options.ignoreFields ?? []);
    const enumIdentifierPattern =
      options.enumIdentifierPattern === undefined
        ? null
        : new RegExp(options.enumIdentifierPattern, 'u');
    const sourceCode = context.sourceCode;

    const fields = new Map<string, IFieldOccurrence[]>();

    /** `z.<name>(...)` on a configured zod namespace. */
    function isZodCall(node: TSESTree.Node, names: ReadonlySet<string>): boolean {
      const call = methodCall(node);
      return (
        call !== null &&
        call.receiver.type === AST_NODE_TYPES.Identifier &&
        zodIdentifiers.has(call.receiver.name) &&
        names.has(call.method)
      );
    }

    function resolveVariable(identifier: TSESTree.Identifier): TSESLint.Scope.Variable | null {
      let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(identifier);
      while (scope !== null) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined) return variable;
        scope = scope.upper;
      }
      return null;
    }

    /** An identifier bound to an enum schema: same-file const, or a matching import. */
    function identifierIsEnum(
      identifier: TSESTree.Identifier,
      seen: ReadonlySet<TSESTree.Node>,
    ): boolean {
      const definition = resolveVariable(identifier)?.defs[0];
      if (definition === undefined) return false;
      if (definition.type === 'ImportBinding') {
        return enumIdentifierPattern !== null && enumIdentifierPattern.test(identifier.name);
      }
      if (definition.type !== 'Variable') return false;
      const init = definition.node.init;
      if (init === null || seen.has(init)) return false;
      return classify(init, new Set([...seen, init])).kind === 'enum';
    }

    function isLiteralUnion(node: TSESTree.Node): boolean {
      if (!isZodCall(node, UNION)) return false;
      const members = (node as TSESTree.CallExpression).arguments[0];
      if (members?.type !== AST_NODE_TYPES.ArrayExpression || members.elements.length === 0) {
        return false;
      }
      return members.elements.every((element) => element !== null && isZodCall(element, LITERAL));
    }

    /** `z.literal(['a', 'b'])`: zod 4's multi-value literal. */
    function isMultiLiteral(node: TSESTree.Node): boolean {
      if (!isZodCall(node, LITERAL)) return false;
      const value = (node as TSESTree.CallExpression).arguments[0];
      return value?.type === AST_NODE_TYPES.ArrayExpression && value.elements.length > 1;
    }

    function classify(node: TSESTree.Node, seen: ReadonlySet<TSESTree.Node>): FieldKind {
      // Enum side: unwrap modifiers (and extract/exclude) down to the root.
      let current: TSESTree.Node = node;
      for (;;) {
        const call = methodCall(current);
        if (call === null || !(MODIFIERS.has(call.method) || ENUM_PRESERVING.has(call.method))) {
          break;
        }
        current = call.receiver;
      }
      if (current.type === AST_NODE_TYPES.Identifier) {
        return identifierIsEnum(current, seen) ? { kind: 'enum', identifier: current.name } : OTHER;
      }
      if (
        isZodCall(current, ENUM_FACTORIES) ||
        isLiteralUnion(current) ||
        isMultiLiteral(current)
      ) {
        return { kind: 'enum', identifier: null };
      }

      // String side: any chain rooted at `z.string()`, unless a link changes the output.
      current = node;
      for (;;) {
        if (isZodCall(current, STRING)) return { kind: 'string' };
        const call = methodCall(current);
        if (call === null || OUTPUT_CHANGING.has(call.method)) return OTHER;
        current = call.receiver;
      }
    }

    function collectShape(shape: TSESTree.Node | undefined): void {
      if (shape?.type !== AST_NODE_TYPES.ObjectExpression) return;
      for (const property of shape.properties) {
        if (property.type !== AST_NODE_TYPES.Property) continue;
        const name = propertyName(property);
        if (name === null || ignoreFields.has(name)) continue;
        const kind = classify(property.value, new Set());
        if (kind.kind === 'other') continue;
        const occurrences = fields.get(name) ?? [];
        occurrences.push({ property, kind });
        fields.set(name, occurrences);
      }
    }

    return {
      CallExpression(node): void {
        if (isZodCall(node, OBJECT_FACTORIES)) {
          collectShape(node.arguments[0]);
          return;
        }
        const call = methodCall(node);
        if (call !== null && SHAPE_EXTENDERS.has(call.method)) collectShape(node.arguments[0]);
      },
      'Program:exit'(): void {
        for (const [field, occurrences] of fields) {
          const enumOccurrence = occurrences.find(isEnumOccurrence);
          if (enumOccurrence === undefined) continue;
          const suggestion =
            enumOccurrence.kind.identifier === null
              ? 'the same enum schema'
              : `\`${enumOccurrence.kind.identifier}\``;
          for (const occurrence of occurrences) {
            if (occurrence.kind.kind !== 'string') continue;
            context.report({
              node: occurrence.property,
              messageId: 'widenedEnumField',
              data: {
                field,
                line: String(enumOccurrence.property.loc.start.line),
                suggestion,
              },
            });
          }
        }
      },
    };
  },
});
