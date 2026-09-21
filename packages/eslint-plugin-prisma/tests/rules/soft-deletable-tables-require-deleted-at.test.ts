import { ruleTester } from '@noctcore/eslint-test-utils';

import { softDeletableTablesRequireDeletedAtRule } from '../../src/rules/soft-deletable-tables-require-deleted-at';

// The conventions the cases below were written against, passed explicitly:
// upstream hardcodes neither the models nor the spread helper.
const SOFT = { softDeleteModels: ['user', 'member'], softDeleteSpreads: ['notDeleted'] };

ruleTester.run(
  'soft-deletable-tables-require-deleted-at',
  softDeletableTablesRequireDeletedAtRule,
  {
    valid: [
      // Explicit deletedAt at the top level of the where.
      {
        code: 'this.client.user.findMany({ where: { deletedAt: null } });',
        options: [SOFT],
      },
      // The repo convention: `...this.notDeleted` spread into the where. This
      // is the case that decides whether the rule is usable at all.
      {
        code: 'this.client.user.findFirst({ where: { id: userId, ...this.notDeleted } });',
        options: [SOFT],
      },
      // Same convention reached through a bare identifier.
      {
        code: 'tx.member.updateMany({ where: { id, ...notDeleted }, data });',
        options: [SOFT],
      },
      // Nested inside AND.
      {
        code: 'this.client.user.count({ where: { AND: [{ tenantId }, { deletedAt: null }] } });',
        options: [SOFT],
      },
      // Nested inside OR.
      {
        code: 'this.client.member.findMany({ where: { OR: [{ deletedAt: null }, { id }] } });',
        options: [SOFT],
      },
      // Nested inside NOT.
      {
        code: 'this.client.user.findMany({ where: { NOT: { deletedAt: null } } });',
        options: [SOFT],
      },
      // Reached through a relation filter. Deliberately accepted: the rule asks
      // whether soft delete was considered, and deciding WHICH model a nested
      // mention constrains needs type information this rule does not use.
      {
        code: 'this.client.user.findMany({ where: { member: { deletedAt: null } } });',
        options: [SOFT],
      },
      // String-literal key.
      {
        code: "this.client.user.findMany({ where: { 'deletedAt': null } });",
        options: [SOFT],
      },
      // A `const where` shared by a page read and its count, which is how the
      // list repositories are written.
      {
        code: 'const where = { tenantId, ...this.notDeleted }; this.client.user.findMany({ where });',
        options: [SOFT],
      },
      // Opaque where: nothing to read, so nothing is claimed.
      {
        code: 'this.client.user.findMany({ where: buildWhere(tenantId) });',
        options: [SOFT],
      },
      // Opaque argument object.
      {
        code: 'this.client.user.findMany(queryArgs);',
        options: [SOFT],
      },
      // A resolvable spread at the args level supplies the where.
      {
        code: 'const pageArgs = { where: { tenantId, deletedAt: null } }; this.client.user.findMany({ ...pageArgs, select });',
        options: [SOFT],
      },
      // A resolvable spread inside the where carries the filter.
      {
        code: 'const live = { deletedAt: null }; this.client.user.findMany({ where: { id, ...live } });',
        options: [SOFT],
      },
      // A model that is not soft-deletable is not policed.
      {
        code: 'this.client.invoice.findMany({ where: { tenantId } });',
        options: [SOFT],
      },
      // Singular selectors are out of the guarded set on purpose.
      {
        code: 'this.client.user.findUnique({ where: { id } });',
        options: [SOFT],
      },
      {
        code: 'this.client.member.findUniqueOrThrow({ where: { id } });',
        options: [SOFT],
      },
      {
        code: 'this.client.member.update({ where: { id }, data });',
        options: [SOFT],
      },
      {
        code: 'this.client.user.delete({ where: { id } });',
        options: [SOFT],
      },
      {
        code: 'this.client.user.upsert({ where: { id }, create, update });',
        options: [SOFT],
      },
      // Creates carry no where at all.
      {
        code: 'this.client.user.create({ data });',
        options: [SOFT],
      },
      // Computed accessors do not match the heuristic shape.
      {
        code: "this.client['user'].findMany({ where: { id } });",
        options: [SOFT],
      },
      // A bare call with no model accessor in front of it.
      {
        code: 'findMany({ where: { id } });',
        options: [SOFT],
      },
      // Custom softDeleteModels: `user` drops out of the policed set.
      {
        code: 'this.client.user.findMany({ where: { id } });',
        options: [{ ...SOFT, softDeleteModels: ['member'] }],
      },
      // Custom deletedAtField.
      {
        code: 'this.client.user.findMany({ where: { archivedAt: null } });',
        options: [{ ...SOFT, deletedAtField: 'archivedAt' }],
      },
      // Custom softDeleteSpreads: a differently named helper is recognised.
      {
        code: 'this.client.user.findMany({ where: { ...this.live } });',
        options: [{ ...SOFT, softDeleteSpreads: ['live'] }],
      },
      // allowIn: a file whose omission is the point is not policed.
      {
        code: 'this.client.user.count({ where: { tenantId } });',
        filename: 'apps/api/src/modules/user/user-purge.service.ts',
        options: [{ ...SOFT, allowIn: ['**/modules/user/user-purge.service.ts'] }],
      },
      // allowIn glob over a directory.
      {
        code: 'this.client.user.count({ where: { tenantId } });',
        filename: 'apps/api/src/modules/user/nested/other.service.ts',
        options: [{ ...SOFT, allowIn: ['**/modules/user/**'] }],
      },
    ],
    invalid: [
      // The plain miss: a live-rows read that reads deleted rows too.
      {
        code: 'this.client.user.findMany({ where: { tenantId } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // The A3/A5 shape: a portal-account lookup that resolves a withdrawn
      // account as if it were live.
      {
        code: 'this.client.user.findFirst({ where: { memberId, kind: PORTAL } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // A bulk write is as dangerous as a read: it mutates the deleted rows.
      {
        code: 'tx.user.updateMany({ where: { id: userId }, data: { role } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      {
        code: 'this.client.member.deleteMany({ where: { accountId } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      {
        code: 'tx.user.updateManyAndReturn({ where: { tenantId }, data });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // No where at all: provably filters nothing.
      {
        code: 'this.client.member.findMany({ select: { id: true } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // No argument at all.
      {
        code: 'tx.member.count();',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // Aggregates take the same filter shape and get the same treatment.
      {
        code: 'this.client.user.aggregate({ where: { tenantId } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      {
        code: "this.client.user.groupBy({ by: ['role'], where: { tenantId } });",
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      {
        code: 'this.client.member.findFirstOrThrow({ where: { id } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // Nested combinators that mention everything except the filter.
      {
        code: 'this.client.user.findMany({ where: { AND: [{ tenantId }, { kind }] } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // A resolvable `const where` missing the filter is reported, which is the
      // other half of resolving the binding at all.
      {
        code: 'const where = { tenantId, kind }; this.client.user.count({ where });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // A resolvable spread that turns out not to carry the filter.
      {
        code: 'const base = { id }; this.client.user.findMany({ where: { ...base } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // The unscoped client is policed like every other: no client injects the
      // soft-delete filter.
      {
        code: 'this.prisma.unscoped.user.findMany({ where: { tenantId } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // A spread whose helper name is not the configured one. Reported rather
      // than excused: any `...this.x` would otherwise silence the rule and make
      // `softDeleteSpreads` decorative.
      {
        code: 'this.client.user.findMany({ where: { ...this.somethingElse } });',
        options: [{ ...SOFT, softDeleteSpreads: ['notDeleted'] }],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // An unresolvable spread inside the where does not excuse the call.
      {
        code: 'this.client.user.findMany({ where: { id, ...extra } });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // Nor does one at the args level.
      {
        code: 'this.client.user.findMany({ ...pageArgs, select });',
        options: [SOFT],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // Custom deletedAtField: only the configured column satisfies the rule.
      {
        code: 'this.client.user.findMany({ where: { deletedAt: null } });',
        options: [{ ...SOFT, deletedAtField: 'archivedAt' }],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // Custom softDeleteModels adds a third model.
      {
        code: 'this.client.subscription.findMany({ where: { memberId } });',
        options: [{ ...SOFT, softDeleteModels: ['subscription'] }],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // allowIn is per-file: a file outside the glob is still policed.
      {
        code: 'this.client.user.count({ where: { tenantId } });',
        filename: 'apps/api/src/modules/user/user.repository.ts',
        options: [{ ...SOFT, allowIn: ['**/modules/user/user-purge.service.ts'] }],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
      // An empty allowIn exempts nothing, which is the default.
      {
        code: 'this.client.user.count({ where: { tenantId } });',
        filename: 'apps/api/src/modules/user/user-purge.service.ts',
        options: [{ ...SOFT, allowIn: [] }],
        errors: [{ messageId: 'missingDeletedAtWhere' }],
      },
    ],
  },
);

ruleTester.run('soft-deletable-tables-require-deleted-at (upstream options)', softDeletableTablesRequireDeletedAtRule, {
  valid: [
    {
      // No softDeleteModels by default: nothing is guessed.
      code: 'this.client.user.findMany({ where: { id } });',
    },
  ],
  invalid: [
    {
      // No spread helper by default, so a `...this.notDeleted` is just an
      // unresolvable spread and the message names the column alone.
      code: 'this.client.user.findMany({ where: { id, ...this.notDeleted } });',
      options: [{ softDeleteModels: ['user'] }],
      errors: [
        {
          messageId: 'missingDeletedAtWhere',
          data: { model: 'user', field: 'deletedAt', spreadHint: '' },
        },
      ],
    },
    {
      code: 'this.client.user.count({ where: { id } });',
      options: [{ softDeleteModels: ['user'], softDeleteSpreads: ['live', 'notDeleted'] }],
      errors: [
        {
          messageId: 'missingDeletedAtWhere',
          data: {
            model: 'user',
            field: 'deletedAt',
            spreadHint: ' (or spread `...live` / `...notDeleted`)',
          },
        },
      ],
    },
  ],
});
