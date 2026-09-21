import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as parser from '@typescript-eslint/parser';
import { ruleTester } from '@noctcore/eslint-test-utils';
import { describe, expect, it, vi } from 'vitest';

import { mutationEntryMustReachAuditRule } from '../../src/rules/mutation-entry-must-reach-audit';

/*
 * The walk crosses files through the type checker, so these cases lint a real
 * project: `tests/fixtures/audit-graph` holds a router's collaborators (a
 * service, a repository on a base class, an audit service, a port, a
 * declaration-file Prisma client) and every case lints `entry.ts` inside it.
 */
// The first case builds the fixture's TypeScript program from cold (lib files
// included), which measured 7s while the whole workspace suite runs in
// parallel. Every later case reuses that program and takes milliseconds.
vi.setConfig({ testTimeout: 30_000 });

const FIXTURES = fileURLToPath(new URL('../fixtures/audit-graph/', import.meta.url));
const filename = path.join(FIXTURES, 'entry.ts');
const languageOptions = {
  parserOptions: { projectService: true, tsconfigRootDir: FIXTURES },
};

/** A router whose members are `members`, wired to the fixture service. */
function router(members: string): string {
  return `
    import { Mutation, Query } from './decorators';
    import { InvoiceService } from './invoice.service';

    export class InvoiceRouter {
      constructor(private readonly invoices: InvoiceService) {}
      ${members}
    }
  `;
}

const mutation = (name: string, call: string): string =>
  `@Mutation() async ${name}() { return this.invoices.${call}; }`;

ruleTester.run('mutation-entry-must-reach-audit', mutationEntryMustReachAuditRule, {
  valid: [
    // The service audits right next to the write.
    { code: router(mutation('approve', `approve('1')`)), filename, languageOptions },
    // The audit sits in a private helper of the service, two calls below the entry.
    { code: router(mutation('approve', `approveViaHelper('1')`)), filename, languageOptions },
    // A write to an `auditModels` delegate IS the audit row.
    { code: router(mutation('create', `createWithAuditRow()`)), filename, languageOptions },
    // A method handed over as a value (`.then(this.auditLater)`) is followed too.
    { code: router(mutation('finish', `finishLater('1')`)), filename, languageOptions },
    // Reads only: nothing to audit.
    { code: router(mutation('read', `read('1')`)), filename, languageOptions },
    // Raw SQL is not a write: an advisory lock is the usual `$executeRaw`.
    { code: router(mutation('lock', `lockOnly()`)), filename, languageOptions },
    // Only the decorated entries are checked: a `@Query` and an undecorated method pass.
    { code: router(`@Query() async rename() { return this.invoices.rename('1', 'x'); }`), filename, languageOptions },
    { code: router(`async rename() { return this.invoices.rename('1', 'x'); }`), filename, languageOptions },
    // A port (an interface with no body) might be the audit: the entry is not reported.
    { code: router(mutation('file', `fileIt('1')`)), filename, languageOptions },
    // So might a function held in a parameter.
    { code: router(mutation('run', `runCallback('1', async () => {})`)), filename, languageOptions },
    // A graph deeper than `maxDepth` is not read to the end, so it is not reported.
    { code: router(mutation('deep', `deep1()`)), filename, languageOptions, options: [{ maxDepth: 2 }] },
    // `unauditedModels`: the model's writes are deliberately not audited.
    { code: router(mutation('tour', `touchTour()`)), filename, languageOptions, options: [{ unauditedModels: ['tourProgress'] }] },
    // `ignoreEntries`: an entry the walk over-approximates, named as the rule names it.
    { code: router(mutation('peek', `peek()`)), filename, languageOptions, options: [{ ignoreEntries: ['InvoiceRouter.peek'] }] },
    // A custom entry decorator: `@Mutation` is then no longer an entry.
    { code: router(mutation('rename', `rename('1', 'x')`)), filename, languageOptions, options: [{ entryDecorators: ['Command'] }] },
    // A custom audit logger method.
    {
      code: `
        import { Mutation } from './decorators';
        import { InvoiceRepository } from './invoice.repository';
        declare const auditTrail: { record(entry: unknown): Promise<void> };
        export class InvoiceRouter {
          constructor(private readonly repository: InvoiceRepository) {}
          @Mutation() async rename() {
            await this.repository.rename('1', 'x');
            await auditTrail.record({});
          }
        }
      `,
      filename,
      languageOptions,
      options: [{ auditMethods: ['record'], auditReceiverPattern: 'auditTrail' }],
    },
  ],
  invalid: [
    // Router -> service -> repository on a base class: the write is found through
    // the delegate's type, since `this.client` matches no receiver option.
    {
      code: router(mutation('rename', `rename('1', 'x')`)),
      filename,
      languageOptions,
      errors: [
        {
          messageId: 'unauditedMutation',
          data: {
            entry: 'InvoiceRouter.rename',
            model: 'invoice',
            method: 'update',
            file: 'invoice.repository.ts',
            line: '10',
            path: 'InvoiceRouter.rename -> InvoiceService.rename -> InvoiceRepository.rename',
          },
        },
      ],
    },
    // The write inside a `$transaction` callback, on `(tx ?? this.client)`.
    {
      code: router(mutation('create', `createInTx()`)),
      filename,
      languageOptions,
      errors: [{ messageId: 'unauditedMutation', data: {
        entry: 'InvoiceRouter.create',
        model: 'invoice',
        method: 'create',
        file: 'invoice.repository.ts',
        line: '6',
        path: 'InvoiceRouter.create -> InvoiceService.createInTx -> InvoiceRepository.create',
      } }],
    },
    // Recursion terminates, and the write below it is still found.
    { code: router(mutation('countdown', `countdown(3)`)), filename, languageOptions, errors: [{ messageId: 'unauditedMutation' }] },
    // Deep, but within the default `maxDepth`.
    { code: router(mutation('deep', `deep1()`)), filename, languageOptions, errors: [{ messageId: 'unauditedMutation' }] },
    // A model outside `unauditedModels` is still reported.
    {
      code: router(mutation('tour', `touchTour()`)),
      filename,
      languageOptions,
      options: [{ unauditedModels: ['invoice'] }],
      errors: [{ messageId: 'unauditedMutation' }],
    },
    // The walk is path-insensitive: a write behind a flag this entry never sets
    // is still reached. This is the documented over-approximation `ignoreEntries` is for.
    { code: router(mutation('peek', `peek()`)), filename, languageOptions, errors: [{ messageId: 'unauditedMutation' }] },
    // Top-level functions (no class above them) on the path are labelled by name.
    {
      code: router(mutation('viaTop', `viaTopLevel()`)),
      filename,
      languageOptions,
      errors: [{ messageId: 'unauditedMutation', data: {
        entry: 'InvoiceRouter.viaTop',
        model: 'invoice',
        method: 'update',
        file: 'invoice.repository.ts',
        line: '10',
        path: 'InvoiceRouter.viaTop -> InvoiceService.viaTopLevel -> renameTopLevel -> InvoiceRepository.rename',
      } }],
    },
    {
      code: router(mutation('viaArrow', `viaArrow()`)),
      filename,
      languageOptions,
      errors: [{ messageId: 'unauditedMutation', data: {
        entry: 'InvoiceRouter.viaArrow',
        model: 'invoice',
        method: 'update',
        file: 'invoice.repository.ts',
        line: '10',
        path: 'InvoiceRouter.viaArrow -> InvoiceService.viaArrow -> renameArrow -> InvoiceRepository.rename',
      } }],
    },
    // A write in the entry itself, through a receiver that matches `receiverPattern`,
    // and an entry declared as an arrow-function property.
    {
      code: `
        import { Mutation } from './decorators';
        import type { PrismaService } from './prisma.service';
        export class InvoiceRouter {
          constructor(private readonly prismaService: PrismaService) {}
          @Mutation() rename = async () => {
            await this.prismaService.client.invoice.update({});
          };
        }
      `,
      filename,
      languageOptions,
      errors: [{ messageId: 'unauditedMutation', data: {
        entry: 'InvoiceRouter.rename',
        model: 'invoice',
        method: 'update',
        file: 'entry.ts',
        line: '7',
        path: 'InvoiceRouter.rename',
      } }],
    },
    // A `.log()` on a logger that is not the audit logger is not an audit.
    {
      code: `
        import { Mutation } from './decorators';
        import { InvoiceService } from './invoice.service';
        import { Logger } from './logger';
        export class InvoiceRouter {
          constructor(private readonly invoices: InvoiceService, private readonly logger: Logger) {}
          @Mutation() async rename() {
            await this.invoices.rename('1', 'x');
            this.logger.log('renamed');
          }
        }
      `,
      filename,
      languageOptions,
      errors: [{ messageId: 'unauditedMutation' }],
    },
  ],
});

describe('mutation-entry-must-reach-audit without type information', () => {
  it('refuses to run rather than passing silently', () => {
    // The Linter RuleTester runs on, so the ESLint 9 floor run exercises it too.
    const fromHere = createRequire(import.meta.url);
    const fromRuleTester = createRequire(fromHere.resolve('@typescript-eslint/rule-tester'));
    const { Linter } = fromRuleTester('eslint') as typeof import('eslint');
    const linter = new Linter({ configType: 'flat' });
    const lint = (): unknown =>
      linter.verify(router(mutation('rename', `rename('1', 'x')`)), [
        {
          files: ['**/*.ts'],
          languageOptions: { parser },
          plugins: { prisma: { rules: { rule: mutationEntryMustReachAuditRule } } },
          rules: { 'prisma/rule': 'error' },
        },
      ], 'entry.ts');
    expect(lint).toThrow(/type information/u);
  });
});
