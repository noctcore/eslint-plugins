import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnscopedPrismaOutsideAllowlistRule } from '../../src/rules/no-unscoped-prisma-outside-allowlist';

const SYSTEM_FILE = fileURLToPath(new URL('../fixtures/system/tenant-sweep.ts', import.meta.url));
const SERVICE = 'apps/api/src/modules/foo/foo.service.ts';

ruleTester.run('no-unscoped-prisma-outside-allowlist', noUnscopedPrismaOutsideAllowlistRule, {
  valid: [
    {
      // Unscoped client used inside an allowlisted seed file is legitimate.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: 'packages/database/prisma/seed.ts',
    },
    {
      // The escape hatch is allowed inside an isolation spec.
      code: 'runWithoutTenantScope(() => this.prisma.unscoped.account.deleteMany());',
      filename: 'apps/api/src/modules/account/account.isolation.spec.ts',
      options: [{ escapeHatchFns: ['runWithoutTenantScope'] }],
    },
    {
      // No escape-hatch function is configured by default, so a same-named
      // helper in a project that never declared one is not reported.
      code: 'runWithoutTenantScope(() => work());',
      filename: SERVICE,
    },
    {
      // receiverPattern: with a custom pattern, `prisma` no longer names a client.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: SERVICE,
      options: [{ receiverPattern: '^db$' }],
    },
    {
      // unscopedProperty: renamed, so `.unscoped` is just a property.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: SERVICE,
      options: [{ unscopedProperty: 'raw' }],
    },
    {
      // allowedFiles: a root-anchored glob matches the workspace-relative path
      // (this repo's root is found through its real lockfile on disk).
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: SYSTEM_FILE,
      options: [{ allowedFiles: ['packages/eslint-plugin-prisma/tests/fixtures/system/**'] }],
    },
    {
      // allowedFiles replaces the defaults, it does not extend them.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: 'apps/api/src/common/database/prisma.service.ts',
      options: [{ allowedFiles: ['**/common/database/prisma.service.ts'] }],
    },
    {
      // The tenant-scoped client must NOT fire, even outside the allowlist.
      code: 'const rows = this.prisma.client.account.findMany();',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
    },
    {
      // A method literally named `unscoped` on a non-prisma receiver is fine.
      code: 'const value = this.cache.unscoped();',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
    },
    {
      // Destructuring the SCOPED `client` is fine: it auto-scopes.
      code: 'const { client } = this.prismaService;',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
    },
    {
      // Destructuring `unscoped` off a non-prisma receiver is not our concern.
      code: 'const { unscoped } = this.somethingElse;',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
    },
    {
      // Destructuring the unscoped client inside an allowlisted isolation spec
      // is legitimate (the spec deliberately drives the raw client).
      code: 'const { unscoped } = this.prismaService;',
      filename: 'apps/api/src/modules/account/account.isolation.spec.ts',
    },
  ],
  invalid: [
    {
      // Branch (a): unscoped client on a `this.prisma` member receiver.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // Branch (a): unscoped client on a bare `prismaService` identifier receiver.
      code: 'const rows = prismaService.unscoped.account.create({ data });',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // Branch (b): a configured escape-hatch call.
      code: 'const rows = runWithoutTenantScope(() => tx.account.findMany());',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      options: [{ escapeHatchFns: ['runWithoutTenantScope'] }],
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // A `*.system.ts` suffix is NOT an opt-out: the wildcard was removed from
      // the allowlist so a file cannot bypass the guard by renaming itself.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: 'apps/api/src/modules/foo/foo.system.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // Destructuring `unscoped` into a binding is the verified evasion: the
      // member-access matcher never sees `.unscoped`, so the destructure site
      // itself must be flagged.
      code: 'const { unscoped } = this.prismaService;',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // A renamed destructure binding is the same evasion.
      code: 'const { unscoped: raw } = this.prismaService;',
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // escapeHatchFns takes several names.
      code: 'withoutScope(() => 1); bypassTenant(() => 2);',
      filename: SERVICE,
      options: [{ escapeHatchFns: ['withoutScope', 'bypassTenant'] }],
      errors: [{ messageId: 'unscopedOutsideAllowlist' }, { messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // receiverPattern: a project whose client is `db` names it explicitly.
      code: 'const rows = this.db.unscoped.account.findMany();',
      filename: SERVICE,
      options: [{ receiverPattern: '^db$' }],
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // unscopedProperty: a project whose unscoped client is `.raw`, in both
      // the member and the destructure form.
      code: 'const rows = this.prisma.raw.account.findMany(); const { raw } = prismaService;',
      filename: SERVICE,
      options: [{ unscopedProperty: 'raw' }],
      errors: [{ messageId: 'unscopedOutsideAllowlist' }, { messageId: 'unscopedOutsideAllowlist' }],
    },
    {
      // The default allowlist does not cover a project's own plumbing file.
      code: 'const rows = this.prisma.unscoped.account.findMany();',
      filename: 'apps/api/src/common/database/prisma.service.ts',
      errors: [{ messageId: 'unscopedOutsideAllowlist' }],
    },
  ],
});
