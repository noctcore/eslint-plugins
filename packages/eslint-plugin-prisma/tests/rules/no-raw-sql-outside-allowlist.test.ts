import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRawSqlOutsideAllowlistRule } from '../../src/rules/no-raw-sql-outside-allowlist';

const SERVICE = 'apps/api/src/modules/foo/foo.service.ts';
const ISOLATION_SPEC = 'apps/api/src/modules/foo/foo.isolation.spec.ts';

ruleTester.run('no-raw-sql-outside-allowlist', noRawSqlOutsideAllowlistRule, {
  valid: [
    {
      // The boot and health probes touch no table.
      code: 'await this.base.$queryRaw`SELECT 1`;',
      filename: 'apps/api/src/common/database/prisma.service.ts',
    },
    {
      code: 'await this.prisma.client.$queryRaw`SELECT 1`;',
      filename: 'apps/api/src/modules/health/indicators/database.health.ts',
    },
    {
      // Advisory locks: `pg_advisory_xact_lock` must not match the LOCK keyword,
      // and the nested template in the interpolation is a bound value.
      code: 'await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-membership:${tenantId}`}::text))`;',
      filename: 'apps/api/src/modules/user/user.repository.ts',
    },
    {
      // Interpolated values are bound parameters, never SQL text, so a value
      // whose NAME looks like a keyword is not a keyword.
      code: 'await tx.$queryRaw`SELECT ${fromDate}::date`;',
      filename: SERVICE,
    },
    {
      // An isolation spec reads tables through the unscoped client on purpose.
      code: 'const rows = await unscoped.$queryRaw`SELECT id FROM "Account" WHERE "tenantId" = ${id}`;',
      filename: ISOLATION_SPEC,
    },
    {
      // The call form is readable only by review, which the allowlist records.
      code: 'await this.prisma.unscoped.$executeRaw(Prisma.sql`DELETE FROM "Account"`);',
      filename: 'packages/database/prisma/seed.ts',
    },
    {
      // A method named like a raw method on something that is not a member
      // access (a plain function) is not a Prisma client.
      code: 'const queryRaw = makeQuery(); queryRaw`SELECT * FROM x`;',
      filename: SERVICE,
    },
    {
      // Custom keyword list: with only DELETE listed, a SELECT FROM passes.
      code: 'await tx.$queryRaw`SELECT id FROM "Account"`;',
      filename: SERVICE,
      options: [{ tableKeywords: ['DELETE'] }],
    },
  ],
  invalid: [
    {
      // The motivating case: a report query reading a tenant table.
      code: 'const rows = await tx.$queryRaw`SELECT id, "firstName" FROM "Employee" WHERE "accountId" = ${accountId}`;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlTouchesTable', data: { keyword: 'FROM' } }],
    },
    {
      // Keywords match whatever the case.
      code: 'await this.prisma.client.$executeRaw`update "Account" set name = ${name}`;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlTouchesTable', data: { keyword: 'UPDATE' } }],
    },
    {
      // Type arguments do not hide the tag, and a keyword in any chunk counts.
      code: 'await unscoped.$queryRaw<{ id: string }[]>`SELECT ${a} ${b} JOIN "Contract" c ON true`;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlTouchesTable', data: { keyword: 'JOIN' } }],
    },
    {
      // Prisma.raw splices text the rule cannot read.
      code: 'await tx.$queryRaw`SELECT ${Prisma.raw(columns)}`;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnreadable', data: { method: '$queryRaw' } }],
    },
    {
      // The call form with Prisma.sql is reported outside the allowlist.
      code: 'await tx.$queryRaw(Prisma.sql`SELECT 1`);',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnreadable', data: { method: '$queryRaw' } }],
    },
    {
      code: 'await this.prisma.client.$queryRawTyped(getEmployees(accountId));',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnreadable', data: { method: '$queryRawTyped' } }],
    },
    {
      // Unsafe variants are reported everywhere, even in an allowlisted file.
      code: 'await unscoped.$executeRawUnsafe(`DELETE FROM "Account" WHERE id = ${id}`);',
      filename: ISOLATION_SPEC,
      errors: [{ messageId: 'rawSqlUnsafe', data: { method: '$executeRawUnsafe' } }],
    },
    {
      code: 'await tx.$queryRawUnsafe("SELECT 1");',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnsafe', data: { method: '$queryRawUnsafe' } }],
    },
    {
      // A bare reference escapes to be called somewhere the text is not visible.
      code: 'const run = tx.$executeRaw; await run`DELETE FROM "Account"`;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnreadable', data: { method: '$executeRaw' } }],
    },
    {
      // Destructuring the method off the client is the same escape.
      code: 'const { $queryRaw } = this.prisma.client;',
      filename: SERVICE,
      errors: [{ messageId: 'rawSqlUnreadable', data: { method: '$queryRaw' } }],
    },
  ],
});
