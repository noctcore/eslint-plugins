import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesAny } from '../utils/allowMatch';
import { walkSome } from '../utils/ast';

const RULE_NAME = 'typed-mock-over-double-cast';

export interface TypedMockOverDoubleCastOptions {
  /** Callees that create a mock function (`jest.fn`, `vi.fn`), as `name` or `obj.name`. */
  readonly mockFactories?: readonly string[];
  /**
   * Globs matched against the cast target: its type name (`PrismaService`,
   * `Prisma.TransactionClient`) and its full source text
   * (`Parameters<Guard['canActivate']>[0]`). A matching target may be
   * double-cast, for types too wide to `Pick` from.
   */
  readonly allowTargets?: readonly string[];
}

type RuleOptions = [TypedMockOverDoubleCastOptions];
type MessageIds = 'doubleCastMock';

const DEFAULT_MOCK_FACTORIES: readonly string[] = ['jest.fn', 'vi.fn'];
const DEFAULT_ALLOW_TARGETS: readonly string[] = [];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mockFactories: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
      minItems: 1,
    },
    allowTargets: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  },
};

/** `name` or `obj.name` for a callee, else null. */
function calleePath(callee: TSESTree.Expression): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.object.type === AST_NODE_TYPES.Identifier
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

/** The dotted name of a type reference (`Prisma.TransactionClient`), else null. */
function typeName(node: TSESTree.TypeNode): string | null {
  if (node.type !== AST_NODE_TYPES.TSTypeReference) {
    return null;
  }
  const parts: string[] = [];
  let current: TSESTree.EntityName = node.typeName;
  while (current.type === AST_NODE_TYPES.TSQualifiedName) {
    parts.unshift(current.right.name);
    current = current.left;
  }
  if (current.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  parts.unshift(current.name);
  return parts.join('.');
}

/** True for `unknown`, `any` and `never`, the cast targets that switch the checker off. */
function isEscapeType(node: TSESTree.TypeNode): boolean {
  return (
    node.type === AST_NODE_TYPES.TSUnknownKeyword ||
    node.type === AST_NODE_TYPES.TSAnyKeyword ||
    node.type === AST_NODE_TYPES.TSNeverKeyword
  );
}

type Cast = TSESTree.TSAsExpression | TSESTree.TSTypeAssertion;

/** True for a cast written either way: `x as T` or `<T>x`. */
function isCast(node: TSESTree.Node): node is Cast {
  return node.type === AST_NODE_TYPES.TSAsExpression || node.type === AST_NODE_TYPES.TSTypeAssertion;
}

export const typedMockOverDoubleCastRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow an object literal of `jest.fn()` / `vi.fn()` mocks cast `as unknown as T`: the double cast switches type checking off, so a mock of a renamed or removed method keeps passing.',
    },
    schema: [optionSchema],
    messages: {
      doubleCastMock:
        'This object of mocks is cast `as unknown as {{target}}`, so the checker no longer sees it: a mock of a renamed or removed method keeps passing. Type it as `jest.Mocked<Pick<{{target}}, ...>>` (`Mocked<Pick<...>>` in Vitest), or check it with `satisfies Partial<{{target}}>`.',
    },
  },
  defaultOptions: [
    {
      mockFactories: [...DEFAULT_MOCK_FACTORIES],
      allowTargets: [...DEFAULT_ALLOW_TARGETS],
    },
  ],
  create(context, [options]) {
    const mockFactories = new Set(options.mockFactories ?? DEFAULT_MOCK_FACTORIES);
    const allowTargets = options.allowTargets ?? DEFAULT_ALLOW_TARGETS;
    const keys = context.sourceCode.visitorKeys;

    function isMockCall(node: TSESTree.Node): boolean {
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return false;
      }
      const path = calleePath(node.callee);
      return path !== null && mockFactories.has(path);
    }

    /** Report an object of mocks cast through `unknown` / `any` / `never` to a real type. */
    function checkCast(node: Cast): void {
      const inner = node.expression;
      if (
        isEscapeType(node.typeAnnotation) ||
        !isCast(inner) ||
        !isEscapeType(inner.typeAnnotation) ||
        inner.expression.type !== AST_NODE_TYPES.ObjectExpression
      ) {
        return;
      }
      if (!walkSome(inner.expression, keys, isMockCall)) {
        return;
      }
      const text = context.sourceCode.getText(node.typeAnnotation);
      const name = typeName(node.typeAnnotation);
      const candidates = name === null ? [text] : [name, text];
      if (candidates.some((candidate) => matchesAny(candidate, allowTargets))) {
        return;
      }
      context.report({ node, messageId: 'doubleCastMock', data: { target: text } });
    }

    return {
      TSAsExpression: checkCast,
      TSTypeAssertion: checkCast,
    };
  },
});
