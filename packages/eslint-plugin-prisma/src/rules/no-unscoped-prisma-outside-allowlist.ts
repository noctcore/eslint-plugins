import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { DEFAULT_SYSTEM_FILES, isAllowlisted } from '../utils/allowlist';
import {
  isPrismaLikeReceiver,
  isUnscopedDestructure,
  nameListSchema,
  receiverPatternSchema,
  resolveReceiverOptions,
  unscopedPropertySchema,
} from '../utils/prisma-receiver';

const RULE_NAME = 'no-unscoped-prisma-outside-allowlist';

export interface NoUnscopedPrismaOutsideAllowlistOptions {
  /** Globs of files allowed to use the unscoped client and the escape hatches. */
  readonly allowedFiles?: readonly string[];
  /** Regular expression source (case-insensitive) a Prisma receiver name must match. */
  readonly receiverPattern?: string;
  /** Member that exposes the unscoped client on a Prisma receiver. */
  readonly unscopedProperty?: string;
  /** Function names that run a callback outside the tenant scope. */
  readonly escapeHatchFns?: readonly string[];
}

type RuleOptions = [NoUnscopedPrismaOutsideAllowlistOptions];
type MessageIds = 'unscopedOutsideAllowlist';

/*
 * With no row-level security, a tenant-scoping Prisma extension is the only
 * thing that keeps one tenant from reading another's rows. The unscoped client
 * (`this.prisma.unscoped.*`) and any "run without tenant scope" helper both
 * bypass that extension, so they are a silent cross-tenant leak anywhere except
 * a handful of legitimate system contexts: seeds, migrations, isolation specs,
 * and whatever plumbing file constructs the client (see `DEFAULT_SYSTEM_FILES`
 * and the `allowedFiles` option).
 *
 * A filename-suffix opt-out such as `**\/*.system.ts` is deliberately not a
 * default: a suffix is too broad (any file could rename itself past the guard).
 * List specific paths instead.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedFiles: nameListSchema,
    receiverPattern: receiverPatternSchema,
    unscopedProperty: unscopedPropertySchema,
    escapeHatchFns: nameListSchema,
  },
};

export const noUnscopedPrismaOutsideAllowlistRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the unscoped Prisma client and tenant-scope escape-hatch functions outside an allowlist of seeds, migrations, isolation tests, and designated system files.',
    },
    schema: [optionSchema],
    messages: {
      unscopedOutsideAllowlist:
        'The unscoped Prisma client bypasses tenant isolation. It is allowed only in seeds, migrations, isolation tests, and designated system files. Use the tenant-scoped client here.',
    },
  },
  defaultOptions: [
    {
      allowedFiles: [...DEFAULT_SYSTEM_FILES],
      escapeHatchFns: [],
    },
  ],
  create(context, [options]) {
    const allowedFiles = options.allowedFiles ?? DEFAULT_SYSTEM_FILES;

    if (isAllowlisted(context.filename, allowedFiles)) {
      return {};
    }

    const receivers = resolveReceiverOptions(options);
    const escapeHatchFns = new Set(options.escapeHatchFns ?? []);

    return {
      // `<prisma-like>.<unscopedProperty>` member access (the unscoped client).
      MemberExpression(node): void {
        if (
          !node.computed &&
          node.property.type === AST_NODE_TYPES.Identifier &&
          node.property.name === receivers.unscopedProperty &&
          isPrismaLikeReceiver(node.object, receivers)
        ) {
          context.report({ node, messageId: 'unscopedOutsideAllowlist' });
        }
      },
      // `const { unscoped } = this.prismaService` (or aliased) pulls the
      // unscoped client into a local binding. The member-access matcher above
      // never sees the `.unscoped` token in that form, so flag the destructure
      // site itself; otherwise the binding is a silent escape from isolation.
      VariableDeclarator(node): void {
        if (isUnscopedDestructure(node, receivers)) {
          context.report({ node, messageId: 'unscopedOutsideAllowlist' });
        }
      },
      // A direct call to a configured escape-hatch function.
      CallExpression(node): void {
        if (node.callee.type === AST_NODE_TYPES.Identifier && escapeHatchFns.has(node.callee.name)) {
          context.report({ node, messageId: 'unscopedOutsideAllowlist' });
        }
      },
    };
  },
});
