import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { PRISMA_WRITE_METHODS } from '../utils/prisma-methods';

const RULE_NAME = 'no-request-body-in-write';

export interface NoRequestBodyInWriteOptions {
  /**
   * Expressions that hold raw client input, spelled as a dotted path. A path
   * ending in `()` is a call (`req.json()`); any other path is a member access
   * (`req.body`), and a deeper access on it (`req.body.user`) counts too.
   * Replaces the default list.
   */
  readonly sources?: readonly string[];
}

type RuleOptions = [NoRequestBodyInWriteOptions];
type MessageIds = 'clientInputInWrite' | 'clientInputInWhere';

/*
 * Mass assignment guard. A Prisma write whose payload IS the request body lets
 * a caller set any column the model has: `role`, `isAdmin`, `tenantId`,
 * `emailVerified`, a relation `connect`. The handler's author only meant the
 * three fields the form shows, and nothing in the types says otherwise because
 * the body is `any` or cast to the create input.
 *
 * Syntactic, no type info. A payload is client input when it is:
 *   - a `sources` path (`req.body`, `ctx.request.body`) or a member access on
 *     one (`req.body.user`);
 *   - a `sources` call (`req.json()`, `c.req.json()`), awaited or not, or a
 *     member access on its result;
 *   - `Object.fromEntries(...)` over client input or over a `FormData` (a
 *     `.formData()` call, or a parameter annotated `FormData`);
 *   - a `const` bound to any of the above, including a destructure
 *     (`const { body } = req`), followed through local bindings;
 *   - any of the above behind `as`, `satisfies`, `!` or `await`, or in either
 *     branch of `?:` / `??` / `||`.
 *
 * Where it is looked for:
 *   - `data` of a create/update, `create` / `update` of an `upsert`: the
 *     payload itself, a spread inside it (`{ ...req.body, ownerId }`), an array
 *     element or spread (`createMany`), and nested relation writes
 *     (`profile: { create: req.body.profile }`);
 *   - `where` of any write, itself or a top-level spread: a client-built filter
 *     can carry operators (`{ not: '' }`) and widen an update or delete to rows
 *     the handler never meant.
 *
 * Deliberately left alone: anything parsed first (`Schema.parse(req.body)`,
 * `.safeParse(...).data`), explicit picks (`{ name: body.name }`), and spreads
 * of values that are not traced back to a source. Report-only: the fix is a
 * schema or a field list, which only the author can write.
 */
const DEFAULT_SOURCES: readonly string[] = [
  'req.body',
  'request.body',
  'ctx.request.body',
  'req.query',
  'req.json()',
  'request.json()',
  'c.req.json()',
  'c.req.parseBody()',
];

const WRITE_METHODS: ReadonlySet<string> = new Set(PRISMA_WRITE_METHODS);

/* Keys under a relation field whose value is itself a write payload. */
const NESTED_PAYLOAD_KEYS: ReadonlySet<string> = new Set(['create', 'update', 'data']);
/* Keys under a relation field whose value is an object holding payload keys. */
const NESTED_OPERATION_KEYS: ReadonlySet<string> = new Set([
  'upsert',
  'connectOrCreate',
  'createMany',
  'updateMany',
]);

const MAX_SOURCE_TEXT = 60;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*(\\(\\))?$',
      },
      uniqueItems: true,
    },
  },
};

/** Plain name of a non-computed property key, identifier or string literal. */
function staticKeyName(prop: TSESTree.Property): string | null {
  if (prop.computed) {
    return null;
  }
  if (prop.key.type === AST_NODE_TYPES.Identifier) {
    return prop.key.name;
  }
  if (prop.key.type === AST_NODE_TYPES.Literal && typeof prop.key.value === 'string') {
    return prop.key.value;
  }
  return null;
}

function findProperty(obj: TSESTree.ObjectExpression, name: string): TSESTree.Property | null {
  for (const prop of obj.properties) {
    if (prop.type === AST_NODE_TYPES.Property && staticKeyName(prop) === name) {
      return prop;
    }
  }
  return null;
}

/** Strip wrappers that do not change the value: `as`, `satisfies`, `!`, `<T>x`, `await`. */
function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.AwaitExpression
  ) {
    current = current.type === AST_NODE_TYPES.AwaitExpression ? current.argument : current.expression;
  }
  return current;
}

/** `a.b.c` for a chain of non-computed members rooted at an identifier or `this`, else null. */
function dottedPath(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (node.type === AST_NODE_TYPES.ThisExpression) {
    return 'this';
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    const object = dottedPath(node.object);
    return object === null ? null : `${object}.${node.property.name}`;
  }
  return null;
}

function isObjectFromEntries(node: TSESTree.CallExpression): boolean {
  return dottedPath(node.callee) === 'Object.fromEntries';
}

/** The `const` declarator an identifier is bound by, or null for params, `let`, imports, globals. */
function constDeclaratorOf(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
): TSESTree.VariableDeclarator | null {
  const variable = ASTUtils.findVariable(scope, identifier);
  if (variable === null || variable.defs.length !== 1) {
    return null;
  }
  const def = variable.defs[0];
  if (
    def === undefined ||
    def.node.type !== AST_NODE_TYPES.VariableDeclarator ||
    def.node.init === null ||
    def.parent?.type !== AST_NODE_TYPES.VariableDeclaration ||
    def.parent.kind !== 'const'
  ) {
    return null;
  }
  return def.node;
}

/** The key an identifier is destructured from in an object pattern: `body` in `{ body }` / `{ body: b }`. */
function destructuredKey(pattern: TSESTree.ObjectPattern, name: string): string | null {
  for (const prop of pattern.properties) {
    if (prop.type !== AST_NODE_TYPES.Property) {
      continue;
    }
    const value = prop.value.type === AST_NODE_TYPES.AssignmentPattern ? prop.value.left : prop.value;
    if (value.type === AST_NODE_TYPES.Identifier && value.name === name) {
      return staticKeyName(prop);
    }
  }
  return null;
}

/** A `const` initializer a plain `const x = <init>` binding resolves to, or null. */
function constInitializerOf(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
): TSESTree.Expression | null {
  const declarator = constDeclaratorOf(identifier, scope);
  if (declarator === null || declarator.id.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  return declarator.init;
}

export const noRequestBodyInWriteRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a Prisma write whose `data` (or `where`) is the raw request body. Passing client input straight through lets a caller set any column (mass assignment) or widen the filter.',
    },
    schema: [optionSchema],
    messages: {
      clientInputInWrite:
        'This write takes its `{{key}}` straight from client input (`{{source}}`), so a caller can set any column the model has (mass assignment). Parse it through a schema, or pick the fields you allow.',
      clientInputInWhere:
        'This write filters with client input (`{{source}}`) as its `where`, so a caller can send operators and widen the write to rows you did not mean. Build the filter from parsed, named fields.',
    },
  },
  defaultOptions: [{ sources: [...DEFAULT_SOURCES] }],
  create(context, [options]) {
    const memberSources = new Set<string>();
    const callSources = new Set<string>();
    for (const source of options.sources ?? DEFAULT_SOURCES) {
      if (source.endsWith('()')) {
        callSources.add(source.slice(0, -2));
      } else {
        memberSources.add(source);
      }
    }
    const { sourceCode } = context;

    /** Whether a member path is a source, or a deeper access on one. */
    function pathIsSource(path: string): boolean {
      for (const source of memberSources) {
        if (path === source || path.startsWith(`${source}.`)) {
          return true;
        }
      }
      return false;
    }

    /** A `FormData` value: a `.formData()` call, a `FormData`-annotated parameter, or a const bound to either. */
    function isFormData(raw: TSESTree.Node, scope: TSESLint.Scope.Scope, seen: Set<TSESTree.Node>): boolean {
      const node = unwrap(raw);
      if (node.type === AST_NODE_TYPES.CallExpression) {
        const callee = node.callee;
        return (
          callee.type === AST_NODE_TYPES.MemberExpression &&
          !callee.computed &&
          callee.property.type === AST_NODE_TYPES.Identifier &&
          callee.property.name === 'formData'
        );
      }
      if (node.type !== AST_NODE_TYPES.Identifier || seen.has(node)) {
        return false;
      }
      seen.add(node);
      const variable = ASTUtils.findVariable(scope, node);
      const def = variable?.defs[0];
      if (def?.type === 'Parameter' && def.name.type === AST_NODE_TYPES.Identifier) {
        const annotation = def.name.typeAnnotation?.typeAnnotation;
        return (
          annotation?.type === AST_NODE_TYPES.TSTypeReference &&
          annotation.typeName.type === AST_NODE_TYPES.Identifier &&
          annotation.typeName.name === 'FormData'
        );
      }
      const init = constInitializerOf(node, scope);
      return init !== null && isFormData(init, scope, seen);
    }

    /** Whether an expression is traced back to raw client input. */
    function isClientInput(
      raw: TSESTree.Node,
      scope: TSESLint.Scope.Scope,
      seen: Set<TSESTree.Node> = new Set(),
    ): boolean {
      const node = unwrap(raw);
      if (seen.has(node)) {
        return false;
      }
      seen.add(node);

      if (node.type === AST_NODE_TYPES.Identifier) {
        if (memberSources.has(node.name)) {
          return true;
        }
        const declarator = constDeclaratorOf(node, scope);
        if (declarator === null || declarator.init === null) {
          return false;
        }
        if (declarator.id.type === AST_NODE_TYPES.Identifier) {
          return isClientInput(declarator.init, scope, seen);
        }
        if (declarator.id.type === AST_NODE_TYPES.ObjectPattern) {
          // `const { body } = req` reads `req.body`; `const { user } = req.body` reads below a source.
          const key = destructuredKey(declarator.id, node.name);
          if (key === null) {
            return false;
          }
          const initPath = dottedPath(unwrap(declarator.init));
          return (
            (initPath !== null && pathIsSource(`${initPath}.${key}`)) ||
            isClientInput(declarator.init, scope, seen)
          );
        }
        return false;
      }

      if (node.type === AST_NODE_TYPES.MemberExpression) {
        const path = dottedPath(node);
        return (path !== null && pathIsSource(path)) || isClientInput(node.object, scope, seen);
      }

      if (node.type === AST_NODE_TYPES.CallExpression) {
        const calleePath = dottedPath(node.callee);
        if (calleePath !== null && callSources.has(calleePath)) {
          return true;
        }
        if (isObjectFromEntries(node) && node.arguments[0] !== undefined) {
          const entries = node.arguments[0];
          return isFormData(entries, scope, new Set()) || isClientInput(entries, scope, seen);
        }
      }
      return false;
    }

    /** Short source text for a message. */
    function describe(node: TSESTree.Node): string {
      const text = sourceCode.getText(node).replace(/\s+/gu, ' ');
      return text.length > MAX_SOURCE_TEXT ? `${text.slice(0, MAX_SOURCE_TEXT - 3)}...` : text;
    }

    /** Candidates for client input among an expression's possible values (`?:`, `??`, `||`). */
    function branchesOf(node: TSESTree.Node): TSESTree.Node[] {
      const inner = unwrap(node);
      if (inner.type === AST_NODE_TYPES.ConditionalExpression) {
        return [...branchesOf(inner.consequent), ...branchesOf(inner.alternate)];
      }
      if (inner.type === AST_NODE_TYPES.LogicalExpression) {
        return [...branchesOf(inner.left), ...branchesOf(inner.right)];
      }
      return [inner];
    }

    /**
     * Check a write payload (`data`, upsert `create` / `update`, a nested
     * relation payload). `at` is where to report when the payload was reached
     * through a local binding, so the report lands on the write, not the const.
     */
    function checkPayload(
      value: TSESTree.Node,
      key: string,
      scope: TSESLint.Scope.Scope,
      at: TSESTree.Node | null,
      seen: Set<TSESTree.Node>,
    ): void {
      for (const branch of branchesOf(value)) {
        if (seen.has(branch)) {
          continue;
        }
        seen.add(branch);
        if (isClientInput(branch, scope)) {
          report('clientInputInWrite', at ?? branch, key, branch);
          continue;
        }
        if (branch.type === AST_NODE_TYPES.Identifier) {
          const init = constInitializerOf(branch, scope);
          if (init !== null) {
            checkPayload(init, key, scope, at ?? branch, seen);
          }
          continue;
        }
        if (branch.type === AST_NODE_TYPES.ArrayExpression) {
          for (const element of branch.elements) {
            if (element === null) {
              continue;
            }
            if (element.type === AST_NODE_TYPES.SpreadElement) {
              if (isClientInput(element.argument, scope)) {
                report('clientInputInWrite', at ?? element, key, element.argument);
              }
              continue;
            }
            checkPayload(element, key, scope, at, seen);
          }
          continue;
        }
        if (branch.type === AST_NODE_TYPES.ObjectExpression) {
          for (const prop of branch.properties) {
            if (prop.type === AST_NODE_TYPES.SpreadElement) {
              if (isClientInput(prop.argument, scope)) {
                report('clientInputInWrite', at ?? prop, key, prop.argument);
              }
              continue;
            }
            const inner = unwrap(prop.value);
            if (inner.type === AST_NODE_TYPES.ObjectExpression) {
              checkRelationWrite(inner, scope, at, seen);
            }
          }
        }
      }
    }

    /** A relation field's value: `{ create: ..., upsert: { create, update }, createMany: { data } }`. */
    function checkRelationWrite(
      obj: TSESTree.ObjectExpression,
      scope: TSESLint.Scope.Scope,
      at: TSESTree.Node | null,
      seen: Set<TSESTree.Node>,
    ): void {
      for (const prop of obj.properties) {
        if (prop.type !== AST_NODE_TYPES.Property) {
          continue;
        }
        const name = staticKeyName(prop);
        if (name === null) {
          continue;
        }
        if (NESTED_PAYLOAD_KEYS.has(name)) {
          checkPayload(prop.value, name, scope, at, seen);
          continue;
        }
        const inner = unwrap(prop.value);
        if (NESTED_OPERATION_KEYS.has(name)) {
          const operations =
            inner.type === AST_NODE_TYPES.ArrayExpression ? inner.elements : [inner];
          for (const operation of operations) {
            if (operation?.type === AST_NODE_TYPES.ObjectExpression) {
              checkRelationWrite(operation, scope, at, seen);
            }
          }
        }
      }
    }

    function checkWhere(value: TSESTree.Node, scope: TSESLint.Scope.Scope): void {
      for (const branch of branchesOf(value)) {
        if (isClientInput(branch, scope)) {
          report('clientInputInWhere', branch, 'where', branch);
          continue;
        }
        if (branch.type !== AST_NODE_TYPES.ObjectExpression) {
          continue;
        }
        for (const prop of branch.properties) {
          if (prop.type === AST_NODE_TYPES.SpreadElement && isClientInput(prop.argument, scope)) {
            report('clientInputInWhere', prop, 'where', prop.argument);
          }
        }
      }
    }

    function report(
      messageId: MessageIds,
      node: TSESTree.Node,
      key: string,
      source: TSESTree.Node,
    ): void {
      context.report({ node, messageId, data: { key, source: describe(source) } });
    }

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !WRITE_METHODS.has(callee.property.name)
        ) {
          return;
        }
        const firstArg = node.arguments[0];
        if (firstArg === undefined || firstArg.type !== AST_NODE_TYPES.ObjectExpression) {
          return;
        }
        const scope = sourceCode.getScope(node);
        const payloadKeys = callee.property.name === 'upsert' ? ['create', 'update'] : ['data'];
        for (const key of payloadKeys) {
          const prop = findProperty(firstArg, key);
          if (prop !== null) {
            checkPayload(prop.value, key, scope, null, new Set());
          }
        }
        const where = findProperty(firstArg, 'where');
        if (where !== null) {
          checkWhere(where.value, scope);
        }
      },
    };
  },
});
