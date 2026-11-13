import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';
import { ASTUtils } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { unwrapExpression } from '../utils';

const RULE_NAME = 'bcrypt-rounds-min';

export interface BcryptRoundsMinOptions {
  readonly minRounds?: number;
  readonly bcryptModules?: readonly string[];
}

type RuleOptions = [BcryptRoundsMinOptions];
type MessageIds = 'roundsTooLow';

const DEFAULT_MIN_ROUNDS = 10;
const DEFAULT_BCRYPT_MODULES: readonly string[] = ['bcrypt', 'bcryptjs'];

/** Zero-based index of the cost argument of each tracked bcrypt function. */
const COST_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ['hash', 1],
  ['hashSync', 1],
  ['genSalt', 0],
  ['genSaltSync', 0],
]);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    minRounds: {
      type: 'integer',
      minimum: 1,
      description: 'The lowest bcrypt cost accepted; a literal cost below it is reported. Defaults to 10.',
    },
    bcryptModules: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        "Module names whose `hash` / `hashSync` / `genSalt` / `genSaltSync` are tracked. A configured list replaces the default `['bcrypt', 'bcryptjs']`.",
    },
  },
};

/*
 * Reports a numeric literal cost below `minRounds` passed to bcrypt: the second
 * argument of `hash` / `hashSync`, the first of `genSalt` / `genSaltSync`. The
 * callee must resolve, through scope, to a module listed in `bcryptModules`: a
 * default or namespace import (`bcrypt.hash`), a named import under any alias
 * (`hash`), `const bcrypt = require('bcrypt')`, or
 * `const { hash } = require('bcrypt')`. Resolving at the call site means a
 * parameter or local that shadows the import is not mistaken for it, and an
 * unbound global `bcrypt` is not tracked at all.
 *
 * A cost that is not a numeric literal (an env value, a config read, a string
 * salt) is accepted on trust: the rule has no way to know its runtime value.
 */

/** True for `require('<m>')` with `m` in `modules`. */
function isRequireOf(node: TSESTree.Expression | null | undefined, modules: ReadonlySet<string>): boolean {
  if (node == null) return false;
  const call = unwrapExpression(node);
  if (
    call.type !== AST_NODE_TYPES.CallExpression ||
    call.callee.type !== AST_NODE_TYPES.Identifier ||
    call.callee.name !== 'require'
  ) {
    return false;
  }
  const source = call.arguments[0];
  return source?.type === AST_NODE_TYPES.Literal && typeof source.value === 'string' && modules.has(source.value);
}

/** The name of a non-computed property key (`a:` or `'a':`), else null. */
function staticPropertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

/**
 * Whether an identifier is bound to a whole bcrypt module: a default or
 * namespace import, or `const bcrypt = require('<m>')`.
 */
function bcryptModuleBinding(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
  modules: ReadonlySet<string>,
): boolean {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def === undefined) return false;
  if (def.type === 'ImportBinding') {
    return (
      def.parent.type === AST_NODE_TYPES.ImportDeclaration &&
      modules.has(def.parent.source.value) &&
      (def.node.type === AST_NODE_TYPES.ImportDefaultSpecifier ||
        def.node.type === AST_NODE_TYPES.ImportNamespaceSpecifier)
    );
  }
  return def.type === 'Variable' && def.node.id.type === AST_NODE_TYPES.Identifier && isRequireOf(def.node.init, modules);
}

/**
 * The tracked bcrypt function an identifier is bound to, through
 * `import { hash [as h] } from '<m>'` or `const { hash[: h] } = require('<m>')`,
 * else null.
 */
function bcryptExportBinding(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
  modules: ReadonlySet<string>,
): string | null {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def === undefined) return null;
  let name: string | null = null;
  if (def.type === 'ImportBinding') {
    if (def.node.type !== AST_NODE_TYPES.ImportSpecifier) return null;
    if (def.parent.type !== AST_NODE_TYPES.ImportDeclaration || !modules.has(def.parent.source.value)) return null;
    const imported = def.node.imported;
    name = imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
  } else if (def.type === 'Variable' && def.node.id.type === AST_NODE_TYPES.ObjectPattern) {
    if (!isRequireOf(def.node.init, modules)) return null;
    const property = def.name.parent;
    if (property?.type !== AST_NODE_TYPES.Property || property.parent !== def.node.id) return null;
    name = staticPropertyName(property);
  }
  return name !== null && COST_ARGUMENT.has(name) ? name : null;
}

/** The tracked bcrypt function a callee calls, else null. */
function bcryptMethod(
  callee: TSESTree.Expression,
  scope: TSESLint.Scope.Scope,
  modules: ReadonlySet<string>,
): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return bcryptExportBinding(callee, scope, modules);
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.object.type !== AST_NODE_TYPES.Identifier ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    !COST_ARGUMENT.has(callee.property.name)
  ) {
    return null;
  }
  return bcryptModuleBinding(callee.object, scope, modules) ? callee.property.name : null;
}

export const bcryptRoundsMinRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A bcrypt `hash` / `hashSync` / `genSalt` / `genSaltSync` call must not pass a literal cost below `minRounds` (default 10).',
    },
    schema: [optionSchema],
    messages: {
      roundsTooLow:
        '`{{method}}` is called with bcrypt cost {{cost}}, below the minimum of {{minRounds}}. Use a cost of at least {{minRounds}}, or read it from configuration.',
    },
  },
  defaultOptions: [{ minRounds: DEFAULT_MIN_ROUNDS, bcryptModules: DEFAULT_BCRYPT_MODULES }],
  create(context, [options]) {
    const minRounds = options.minRounds ?? DEFAULT_MIN_ROUNDS;
    const modules: ReadonlySet<string> = new Set(options.bcryptModules ?? DEFAULT_BCRYPT_MODULES);

    return {
      CallExpression(node) {
        const method = bcryptMethod(node.callee, context.sourceCode.getScope(node), modules);
        if (method === null) return;
        const cost = node.arguments[COST_ARGUMENT.get(method) ?? -1];
        if (cost === undefined || cost.type === AST_NODE_TYPES.SpreadElement) return;
        const literal = unwrapExpression(cost);
        if (literal.type !== AST_NODE_TYPES.Literal || typeof literal.value !== 'number') return;
        if (literal.value >= minRounds) return;
        context.report({
          node: cost,
          messageId: 'roundsTooLow',
          data: { method, cost: String(literal.value), minRounds: String(minRounds) },
        });
      },
    };
  },
});
