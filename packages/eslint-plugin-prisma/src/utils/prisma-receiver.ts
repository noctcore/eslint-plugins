import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

/**
 * Shared receiver-shape helpers for the Prisma rules.
 *
 * Without row-level security, the only things that keep one tenant from
 * reading another's rows are a tenant-scoping client extension and lint rules
 * like these. A rule that matches only the literal `this.prisma.unscoped.x`
 * shape is trivially bypassed by binding the unscoped client to a local first
 * (`const { unscoped } = this.prismaService; unscoped.invoice.findMany(...)`),
 * so the helpers here resolve a bare-identifier receiver back through its
 * binding to detect that the chain ultimately reaches the unscoped client.
 *
 * This is name/shape matching with no type information: it raises the bar
 * against the common evasions (destructure, single-hop alias) but cannot follow
 * a client laundered through a function return (`getDb()`). Only RLS is a
 * complete backstop; these rules are the static layer in front of it.
 *
 * Nothing here names a project convention. What a Prisma receiver looks like,
 * what the unscoped client is called, which property exposes a scoped client
 * and what a transaction client is conventionally named all arrive as options,
 * resolved once per rule through `resolveReceiverOptions`.
 */

/** Default `receiverPattern`: any identifier containing `prisma` (case-insensitive). */
export const DEFAULT_RECEIVER_PATTERN = 'prisma';

/** Default `unscopedProperty`: the member that exposes the unscoped client. */
export const DEFAULT_UNSCOPED_PROPERTY = 'unscoped';

/** Default `txRootNames`: the conventional name of an interactive transaction client. */
export const DEFAULT_TX_ROOT_NAMES: readonly string[] = ['tx'];

/**
 * Default `clientProperties`: none. A repository base class that exposes the
 * Prisma client as `this.client` is common, but so is `this.client` holding an
 * HTTP or SDK client (`this.client.messages.create(...)`), so recognising the
 * name by default would report unrelated code.
 */
export const DEFAULT_CLIENT_PROPERTIES: readonly string[] = [];

/** Receiver options as a rule's options object carries them. */
export interface ReceiverOptions {
  /**
   * Regular expression source, compiled case-insensitively, that an identifier
   * or property name must match to count as a Prisma client.
   */
  readonly receiverPattern?: string;
  /** Member name that exposes the unscoped (extension-bypassing) client. */
  readonly unscopedProperty?: string;
  /** Property names that expose a Prisma client without matching `receiverPattern`. */
  readonly clientProperties?: readonly string[];
  /** Root identifiers that are a Prisma transaction client (e.g. `tx`). */
  readonly txRootNames?: readonly string[];
}

/** The same options with defaults applied and the pattern compiled. */
export interface ResolvedReceiverOptions {
  readonly receiverPattern: RegExp;
  readonly unscopedProperty: string;
  readonly clientProperties: ReadonlySet<string>;
  readonly txRootNames: ReadonlySet<string>;
}

/** JSON schema entries for the receiver options, spread into a rule's option schema. */
export const receiverPatternSchema: JSONSchema4 = { type: 'string', minLength: 1 };
export const unscopedPropertySchema: JSONSchema4 = { type: 'string', minLength: 1 };
export const nameListSchema: JSONSchema4 = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  uniqueItems: true,
};
/** `nameListSchema` that must name at least one entry. */
export const nonEmptyNameListSchema: JSONSchema4 = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  uniqueItems: true,
  minItems: 1,
};

export function resolveReceiverOptions(options: ReceiverOptions): ResolvedReceiverOptions {
  return {
    receiverPattern: new RegExp(options.receiverPattern ?? DEFAULT_RECEIVER_PATTERN, 'iu'),
    unscopedProperty: options.unscopedProperty ?? DEFAULT_UNSCOPED_PROPERTY,
    clientProperties: new Set(options.clientProperties ?? DEFAULT_CLIENT_PROPERTIES),
    txRootNames: new Set(options.txRootNames ?? DEFAULT_TX_ROOT_NAMES),
  };
}

/** A non-computed `.<name>` member access whose property name matches. */
export function isMemberNamed(node: TSESTree.Node, name: string): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === name
  );
}

/**
 * True when `node` looks like a Prisma-ish receiver: a bare identifier whose name
 * matches `receiverPattern` (e.g. `prisma`, `prismaService`) or a non-computed
 * member access whose property name matches (e.g. `this.prisma`,
 * `app.prismaService`).
 */
export function isPrismaLikeReceiver(node: TSESTree.Node, options: ResolvedReceiverOptions): boolean {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return options.receiverPattern.test(node.name);
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    return options.receiverPattern.test(node.property.name);
  }
  return false;
}

/**
 * Whether a receiver chain looks like a Prisma client, so that a write on it is
 * actually a Prisma write and not an unrelated fluent `.update()` / `.delete()`
 * (e.g. `createHash('sha256').update(...)`, `this.cache.delete(key)`). True when
 * any non-computed property in the chain matches `receiverPattern` or is one of
 * `clientProperties`, or the root identifier matches `receiverPattern` or is one
 * of `txRootNames`.
 */
export function receiverLooksLikePrisma(
  node: TSESTree.Node,
  options: ResolvedReceiverOptions,
): boolean {
  let current: TSESTree.Node = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    if (
      !current.computed &&
      current.property.type === AST_NODE_TYPES.Identifier &&
      (options.clientProperties.has(current.property.name) ||
        options.receiverPattern.test(current.property.name))
    ) {
      return true;
    }
    current = current.object;
  }
  if (current.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  return options.txRootNames.has(current.name) || options.receiverPattern.test(current.name);
}

/** True when an ObjectPattern binds the unscoped property (`{ unscoped }` or `{ unscoped: alias }`). */
function objectPatternBindsUnscoped(
  pattern: TSESTree.ObjectPattern,
  options: ResolvedReceiverOptions,
): boolean {
  return pattern.properties.some(
    (prop) =>
      prop.type === AST_NODE_TYPES.Property &&
      !prop.computed &&
      prop.key.type === AST_NODE_TYPES.Identifier &&
      prop.key.name === options.unscopedProperty,
  );
}

/**
 * True when `declarator` pulls the unscoped client out of a prisma-like object
 * via destructuring: `const { unscoped } = this.prismaService` (or aliased
 * `const { unscoped: raw } = ...`). This is the binding-site evasion the
 * member-access matchers miss, so the no-unscoped rule flags it here directly.
 */
export function isUnscopedDestructure(
  declarator: TSESTree.VariableDeclarator,
  options: ResolvedReceiverOptions,
): boolean {
  return (
    declarator.id.type === AST_NODE_TYPES.ObjectPattern &&
    declarator.init !== null &&
    isPrismaLikeReceiver(declarator.init, options) &&
    objectPatternBindsUnscoped(declarator.id, options)
  );
}

/** True when a variable declarator's initializer is `<prisma-like>.<unscopedProperty>`. */
function initializerIsUnscopedMember(
  init: TSESTree.Expression | null,
  options: ResolvedReceiverOptions,
): boolean {
  return (
    init !== null &&
    init.type === AST_NODE_TYPES.MemberExpression &&
    isMemberNamed(init, options.unscopedProperty) &&
    isPrismaLikeReceiver(init.object, options)
  );
}

/**
 * Resolve a bare identifier through its declaration and report whether it was
 * bound to the unscoped client, either by member access (`const u =
 * prismaSvc.unscoped`) or by destructuring (`const { unscoped: u } = prismaSvc`).
 */
function identifierResolvesToUnscoped(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
  options: ResolvedReceiverOptions,
): boolean {
  const variable = ASTUtils.findVariable(scope, identifier);
  if (variable === null) {
    return false;
  }
  return variable.defs.some((def) => {
    if (def.node.type !== AST_NODE_TYPES.VariableDeclarator) {
      return false;
    }
    if (initializerIsUnscopedMember(def.node.init, options)) {
      return true;
    }
    return (
      def.node.id.type === AST_NODE_TYPES.ObjectPattern &&
      def.node.init !== null &&
      isPrismaLikeReceiver(def.node.init, options) &&
      objectPatternBindsUnscoped(def.node.id, options)
    );
  });
}

/**
 * True when a receiver chain reaches the unscoped client: directly (any
 * `.<unscopedProperty>` member in the chain, e.g. `this.prisma.unscoped.invoice`)
 * or via a bare-identifier root resolved back to an unscoped binding (e.g.
 * `const { unscoped } = svc; unscoped.invoice` -> the chain root `unscoped`
 * resolves to a destructure of `svc.unscoped`).
 */
export function chainResolvesToUnscoped(
  node: TSESTree.Node,
  scope: TSESLint.Scope.Scope,
  options: ResolvedReceiverOptions,
): boolean {
  let current: TSESTree.Node | undefined = node;
  while (current && current.type === AST_NODE_TYPES.MemberExpression) {
    if (isMemberNamed(current, options.unscopedProperty)) {
      return true;
    }
    current = current.object;
  }
  if (current && current.type === AST_NODE_TYPES.Identifier) {
    return identifierResolvesToUnscoped(current, scope, options);
  }
  return false;
}
