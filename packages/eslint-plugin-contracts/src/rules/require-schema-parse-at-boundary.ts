import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'require-schema-parse-at-boundary';

type MessageIds = 'castedBoundaryData';

/*
 * External data crossing a trust boundary must be PARSED at runtime (zod /
 * valibot), not merely asserted with `as T`. A cast is a compile-time promise
 * TypeScript never checks — a shape change on the wire slips straight through and
 * corrupts state far from the boundary.
 *
 * A fully general form of this rule needs type information (to know an arbitrary
 * value originated at a boundary). The shared tester is NOT type-aware, so this
 * ships a CONSERVATIVE SYNTACTIC slice: it flags only a cast applied DIRECTLY to
 * a call site that is unmistakably a boundary read —
 *   - `JSON.parse(...) as T`
 *   - `(await res.json()) as T`  (await of any `.json()` call)
 * and only when the cast target is a named type or array (`as User`, `as User[]`),
 * i.e. a shape claim. Casts to `unknown`, `any`, or `const` are the safe/neutral
 * forms and are never flagged. Anything less direct (a boundary value stored in a
 * variable, then cast later) is out of syntactic reach and left to a type-aware
 * setup.
 */

/** `JSON.parse(...)` call. */
function isJsonParseCall(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    !node.callee.computed &&
    node.callee.object.type === AST_NODE_TYPES.Identifier &&
    node.callee.object.name === 'JSON' &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    node.callee.property.name === 'parse'
  );
}

/** `await <anything>.json()` — the canonical fetch/Response body read. */
function isAwaitJsonCall(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.AwaitExpression) {
    return false;
  }
  const call = node.argument;
  return (
    call.type === AST_NODE_TYPES.CallExpression &&
    call.arguments.length === 0 &&
    call.callee.type === AST_NODE_TYPES.MemberExpression &&
    !call.callee.computed &&
    call.callee.property.type === AST_NODE_TYPES.Identifier &&
    call.callee.property.name === 'json'
  );
}

/**
 * True when the cast target is a shape claim (a named type reference other than
 * `const`, or an array type). `as unknown` / `as any` / `as const` and bare
 * primitive keywords are the safe forms and return false.
 */
function isShapeClaim(annotation: TSESTree.TypeNode): boolean {
  if (annotation.type === AST_NODE_TYPES.TSArrayType) {
    return true;
  }
  if (annotation.type === AST_NODE_TYPES.TSTypeReference) {
    return !(
      annotation.typeName.type === AST_NODE_TYPES.Identifier &&
      annotation.typeName.name === 'const'
    );
  }
  return false;
}

export const requireSchemaParseAtBoundaryRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow asserting external boundary data with `as T` instead of parsing it at runtime. Flags `JSON.parse(...) as T` and `(await res.json()) as T`; use a zod/valibot parse.',
    },
    schema: [],
    messages: {
      castedBoundaryData:
        'Boundary data is asserted with `as` here, not parsed. A cast is unchecked — validate this with a runtime schema (e.g. `Schema.parse(...)`) so a wire-shape change fails loudly.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      TSAsExpression(node): void {
        if (!isShapeClaim(node.typeAnnotation)) {
          return;
        }
        const expr = node.expression;
        if (isJsonParseCall(expr) || isAwaitJsonCall(expr)) {
          context.report({ node, messageId: 'castedBoundaryData' });
        }
      },
    };
  },
});
