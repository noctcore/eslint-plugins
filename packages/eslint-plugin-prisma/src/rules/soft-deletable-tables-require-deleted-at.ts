import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isAllowlisted } from '../utils/allowlist';
import { PRISMA_FILTERED_WRITE_METHODS, PRISMA_SCOPED_READ_METHODS } from '../utils/prisma-methods';
import { nameListSchema, nonEmptyNameListSchema } from '../utils/prisma-receiver';

const RULE_NAME = 'soft-deletable-tables-require-deleted-at';

export interface SoftDeletableTablesRequireDeletedAtOptions {
  /** Prisma delegate accessors carrying the soft-delete column (`user`, not `User`). */
  readonly softDeleteModels?: readonly string[];
  /** The soft-delete column every guarded `where` must mention. */
  readonly deletedAtField?: string;
  /**
   * Names of the shared soft-delete filter helper, recognised when SPREAD into a
   * `where` (`...this.notDeleted`, `...notDeleted`).
   *
   * This is the option that decides whether the rule is shippable in a codebase
   * with a soft-delete convention, such as a repository base class exposing
   * `notDeleted = { deletedAt: null }` that call sites spread rather than spell
   * out. A rule blind to the spread reports correct code several times as often
   * as it reports a defect, and gets turned off rather than obeyed.
   */
  readonly softDeleteSpreads?: readonly string[];
  /**
   * Globs of files this rule does not police. Like
   * `tenant-scoped-tables-require-where`, this defaults to nothing: every entry
   * is an app-level judgement to be written down in the config, next to the
   * reason it holds.
   */
  readonly allowIn?: readonly string[];
  /**
   * Narrower than `allowIn`: exempt only the calls made inside the named
   * functions of the matching files, and keep policing every other call in
   * them. Use it when the omission is one query's judgement, not the file's.
   *
   * A call belongs to its NEAREST NAMED enclosing function: a class method, a
   * function declaration, or a function bound to a variable or an object key.
   * Anonymous callbacks are looked through, so a count inside
   * `Promise.all([...])` or a `$transaction(async (tx) => ...)` body still
   * belongs to the method around it. A named helper declared inside an
   * exempt function is its own function and is policed.
   */
  readonly allowInFunctions?: readonly SoftDeleteFunctionExemption[];
}

/** One `allowInFunctions` entry: these functions, in these files. */
export interface SoftDeleteFunctionExemption {
  /** Globs of the files the entry applies to, matched like `allowIn`. */
  readonly files: readonly string[];
  /** Names of the functions whose own calls are not policed. */
  readonly functions: readonly string[];
}

type RuleOptions = [SoftDeletableTablesRequireDeletedAtOptions];
type MessageIds = 'missingDeletedAtWhere';

/*
 * A soft-deleted row survives its delete and is excluded by a `deletedAt: null`
 * filter. Nothing enforces that filter. Unlike a tenant boundary, which can have
 * a Prisma `$extends` layer injecting the scope column, soft delete is usually
 * pure convention, so a query that forgets it silently reads or mutates deleted
 * rows while every type and every test still passes. The classic defect is a
 * lookup that resolves an account without excluding a deleted one, handing data
 * to a user whose access was revoked.
 *
 * Heuristic only (identifier names + member-expression shapes, no type info),
 * matching the `<anything>.<model>.<method>(` spelling of a Prisma call:
 *   - the call's method is one of the filtered read / bulk-write methods;
 *   - its receiver is a `<...>.<model>` accessor named in `softDeleteModels`;
 *   - the first argument's `where` subtree mentions `deletedAt` NOWHERE, at any
 *     depth, and spreads no recognised soft-delete helper.
 *
 * Every client is policed, not just `unscoped`: no client injects `deletedAt`.
 *
 * SINGULAR methods (`findUnique`, `findUniqueOrThrow`, `update`, `delete`,
 * `upsert`) are deliberately NOT guarded, for the same reason
 * `tenant-scoped-tables-require-where` leaves them out: their `where` is a
 * unique selector, and demanding a second predicate inside one reads as noise at
 * the call site. They are not harmless -- a `findUnique({ where: { id } })` does
 * return a soft-deleted row -- so those sites need review by hand; what is not
 * claimed is static coverage of them.
 *
 * One accepted blind spot, chosen to keep the rule from reporting correct code
 * (a guard that fires on working queries gets disabled, not obeyed):
 *   - an OPAQUE `where` (anything that does not resolve to an object literal,
 *     e.g. `findMany({ where: buildWhere() })`) is not reported. One hop of
 *     binding resolution is done, which is what the
 *     `const where = { ..., ...this.notDeleted }` then `findMany({ where })` /
 *     `count({ where })` pairing of a paged list needs.
 * A MISSING `where` is the opposite case and IS reported: `user.findMany({
 * select })` provably filters nothing. So is an unresolvable SPREAD
 * (`{ id, ...this.somethingElse }`): treating it as possibly carrying the
 * filter would let any spread silence the rule and make `softDeleteSpreads`
 * decorative, and a helper that does carry the filter belongs in that option.
 */
const GUARDED_METHODS: ReadonlySet<string> = new Set([
  ...PRISMA_SCOPED_READ_METHODS,
  ...PRISMA_FILTERED_WRITE_METHODS,
]);

/* Empty: which models are soft-deletable is the schema's answer, named in the config. */
const DEFAULT_SOFT_DELETE_MODELS: readonly string[] = [];
const DEFAULT_DELETED_AT_FIELD = 'deletedAt';
/* Empty: a helper name is a project convention, never assumed. */
const DEFAULT_SOFT_DELETE_SPREADS: readonly string[] = [];
/* Empty: an exemption is only ever granted from the config, never by default. */
const DEFAULT_ALLOW_IN: readonly string[] = [];
const DEFAULT_ALLOW_IN_FUNCTIONS: readonly SoftDeleteFunctionExemption[] = [];

/** Cheap blowup guard; real Prisma filters nest a handful of levels. */
const MAX_WHERE_DEPTH = 12;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    softDeleteModels: nameListSchema,
    deletedAtField: { type: 'string', minLength: 1 },
    softDeleteSpreads: nameListSchema,
    allowIn: nameListSchema,
    allowInFunctions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['files', 'functions'],
        properties: {
          files: nonEmptyNameListSchema,
          functions: nonEmptyNameListSchema,
        },
      },
    },
  },
};

/** The static property name of a non-computed member expression, if it has one. */
function staticPropertyName(node: TSESTree.MemberExpression): string | null {
  if (node.computed) {
    return null;
  }
  return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : null;
}

/** The static key name of a non-computed property (`deletedAt` or `'deletedAt'`). */
function staticKeyName(property: TSESTree.Property): string | null {
  if (property.computed) {
    return null;
  }
  if (property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

/**
 * Resolve a node to the object literal it stands for: itself when it already is
 * one, or the initializer of the binding a bare identifier was declared with
 * (`const where = { ... }`). Returns null for anything else, which the callers
 * read as "opaque".
 */
function resolveObjectLiteral(
  node: TSESTree.Node,
  scope: TSESLint.Scope.Scope,
): TSESTree.ObjectExpression | null {
  if (node.type === AST_NODE_TYPES.ObjectExpression) {
    return node;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = ASTUtils.findVariable(scope, node);
  if (variable === null) {
    return null;
  }
  for (const def of variable.defs) {
    if (
      def.node.type === AST_NODE_TYPES.VariableDeclarator &&
      def.node.init !== null &&
      def.node.init.type === AST_NODE_TYPES.ObjectExpression
    ) {
      return def.node.init;
    }
  }
  return null;
}

/** True when a spread's argument is one of the recognised soft-delete helpers. */
function isSoftDeleteSpread(argument: TSESTree.Node, spreadNames: ReadonlySet<string>): boolean {
  if (argument.type === AST_NODE_TYPES.Identifier) {
    return spreadNames.has(argument.name);
  }
  if (argument.type === AST_NODE_TYPES.MemberExpression) {
    const name = staticPropertyName(argument);
    return name !== null && spreadNames.has(name);
  }
  return false;
}

/** The name a function node is known by at its definition site, if any. */
function functionName(fn: TSESTree.FunctionLike): string | null {
  if (
    (fn.type === AST_NODE_TYPES.FunctionDeclaration ||
      fn.type === AST_NODE_TYPES.FunctionExpression) &&
    fn.id !== null
  ) {
    return fn.id.name;
  }
  const parent = fn.parent;
  if (
    (parent.type === AST_NODE_TYPES.MethodDefinition ||
      parent.type === AST_NODE_TYPES.PropertyDefinition ||
      parent.type === AST_NODE_TYPES.Property) &&
    !parent.computed &&
    parent.value === fn
  ) {
    if (parent.key.type === AST_NODE_TYPES.Identifier) {
      return parent.key.name;
    }
    if (parent.key.type === AST_NODE_TYPES.Literal && typeof parent.key.value === 'string') {
      return parent.key.value;
    }
    return null;
  }
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === fn &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  return null;
}

const FUNCTION_TYPES: ReadonlySet<AST_NODE_TYPES> = new Set([
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
  AST_NODE_TYPES.ArrowFunctionExpression,
]);

/**
 * The nearest named function around a node, looking through anonymous ones
 * (callbacks), or null at module level.
 */
function enclosingFunctionName(node: TSESTree.Node): string | null {
  // A truthiness test, not `!== undefined`: ESLint 10 sets `Program.parent` to
  // null while the typings declare it absent, so a strict check walks off the
  // root.
  for (let current: TSESTree.Node | undefined = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) {
      const name = functionName(current as TSESTree.FunctionLike);
      if (name !== null) {
        return name;
      }
    }
  }
  return null;
}

interface ICoverageContext {
  readonly scope: TSESLint.Scope.Scope;
  readonly deletedAtField: string;
  readonly spreadNames: ReadonlySet<string>;
}

/**
 * True when the subtree mentions the soft-delete column at any depth, spreads a
 * recognised helper, or is opaque enough that it might do either.
 *
 * Recursion follows every object and array value, not just `AND`/`OR`/`NOT`, so
 * a filter reached through a relation (`{ owner: { deletedAt: null } }`)
 * counts. That is deliberately permissive: the rule asks whether soft delete was
 * CONSIDERED at this call site, and proving that a mention actually constrains
 * the right model needs the type information this rule does not use.
 */
function subtreeCoversSoftDelete(
  node: TSESTree.Node,
  ctx: ICoverageContext,
  depth: number,
): boolean {
  if (depth > MAX_WHERE_DEPTH) {
    return true;
  }
  if (node.type === AST_NODE_TYPES.ArrayExpression) {
    return node.elements.some(
      (element) => element !== null && subtreeCoversSoftDelete(element, ctx, depth + 1),
    );
  }
  if (node.type !== AST_NODE_TYPES.ObjectExpression) {
    return false;
  }
  return node.properties.some((property) => {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      if (isSoftDeleteSpread(property.argument, ctx.spreadNames)) {
        return true;
      }
      const spreadObject = resolveObjectLiteral(property.argument, ctx.scope);
      // An unresolvable spread contributes nothing rather than excusing the
      // call: `where: { ...this.anything }` would otherwise silence the rule,
      // which would make `softDeleteSpreads` decorative. A helper that does
      // carry the filter is named in that option instead.
      return spreadObject !== null && subtreeCoversSoftDelete(spreadObject, ctx, depth + 1);
    }
    if (staticKeyName(property) === ctx.deletedAtField) {
      return true;
    }
    return subtreeCoversSoftDelete(property.value, ctx, depth + 1);
  });
}

/**
 * Given the first call argument, returns false only when the query provably
 * carries no soft-delete filter: the `where` is present and free of one, or
 * there is no `where` at all.
 */
function callCoversSoftDelete(arg: TSESTree.Node | undefined, ctx: ICoverageContext): boolean {
  if (arg === undefined) {
    // `user.count()` filters nothing at all.
    return false;
  }
  const args = resolveObjectLiteral(arg, ctx.scope);
  if (args === null) {
    // Opaque argument object (`findMany(queryArgs)`): nothing to read.
    return true;
  }
  const whereProperty = args.properties.find(
    (property): property is TSESTree.Property =>
      property.type === AST_NODE_TYPES.Property && staticKeyName(property) === 'where',
  );
  if (whereProperty === undefined) {
    // A spread at the args level can still supply the `where`, so look through
    // one that resolves. An unresolvable one is not an excuse, for the same
    // reason it is not one inside the `where`.
    return args.properties.some((property) => {
      if (property.type !== AST_NODE_TYPES.SpreadElement) {
        return false;
      }
      const spreadArgs = resolveObjectLiteral(property.argument, ctx.scope);
      return spreadArgs !== null && callCoversSoftDelete(spreadArgs, ctx);
    });
  }
  const whereObject = resolveObjectLiteral(whereProperty.value, ctx.scope);
  if (whereObject === null) {
    // Opaque where (a call, a ternary, an unresolved binding): not reported.
    return true;
  }
  return subtreeCoversSoftDelete(whereObject, ctx, 0);
}

export const softDeletableTablesRequireDeletedAtRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a filtered read or bulk write on a soft-deletable Prisma model to exclude soft-deleted rows in its `where`. Soft delete is convention only, with no Prisma extension injecting the filter, so a query that omits it reads and mutates deleted rows.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      missingDeletedAtWhere:
        'A read or bulk mutation on the soft-deletable `{{model}}` model must exclude soft-deleted rows: filter `{{field}}` in the `where`{{spreadHint}}. No Prisma extension injects this filter, so without it the query sees deleted rows.',
    },
  },
  defaultOptions: [
    {
      softDeleteModels: [...DEFAULT_SOFT_DELETE_MODELS],
      deletedAtField: DEFAULT_DELETED_AT_FIELD,
      softDeleteSpreads: [...DEFAULT_SOFT_DELETE_SPREADS],
      allowIn: [...DEFAULT_ALLOW_IN],
      allowInFunctions: [...DEFAULT_ALLOW_IN_FUNCTIONS],
    },
  ],
  create(context, [options]) {
    if (isAllowlisted(context.filename, options.allowIn ?? DEFAULT_ALLOW_IN)) {
      return {};
    }

    // The functions exempt in THIS file: the union over every entry whose
    // globs match it. Empty for most files, which then pay nothing per call.
    const exemptFunctions = new Set(
      (options.allowInFunctions ?? DEFAULT_ALLOW_IN_FUNCTIONS)
        .filter((entry) => isAllowlisted(context.filename, entry.files))
        .flatMap((entry) => entry.functions),
    );

    const softDeleteModels = new Set(options.softDeleteModels ?? DEFAULT_SOFT_DELETE_MODELS);
    const deletedAtField = options.deletedAtField ?? DEFAULT_DELETED_AT_FIELD;
    const spreadList = options.softDeleteSpreads ?? DEFAULT_SOFT_DELETE_SPREADS;
    const spreadNames = new Set(spreadList);
    const spreadHint =
      spreadList.length === 0 ? '' : ` (or spread \`...${spreadList.join('` / `...')}\`)`;

    return {
      CallExpression(node): void {
        // Shape: <receiver>.<softDeleteModel>.<guardedMethod>(...)
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        const methodName = staticPropertyName(callee);
        if (methodName === null || !GUARDED_METHODS.has(methodName)) {
          return;
        }
        const modelAccessor = callee.object;
        if (modelAccessor.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        const modelName = staticPropertyName(modelAccessor);
        if (modelName === null || !softDeleteModels.has(modelName)) {
          return;
        }
        const ctx: ICoverageContext = {
          scope: context.sourceCode.getScope(node),
          deletedAtField,
          spreadNames,
        };
        if (callCoversSoftDelete(node.arguments[0], ctx)) {
          return;
        }
        const owner = exemptFunctions.size === 0 ? null : enclosingFunctionName(node);
        if (owner === null || !exemptFunctions.has(owner)) {
          context.report({
            node,
            messageId: 'missingDeletedAtWhere',
            data: { model: modelName, field: deletedAtField, spreadHint },
          });
        }
      },
    };
  },
});
