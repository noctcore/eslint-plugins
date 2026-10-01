import { ruleTester } from '@noctcore/eslint-test-utils';

import { typedMockOverDoubleCastRule } from '../../src/rules/typed-mock-over-double-cast';

ruleTester.run('typed-mock-over-double-cast', typedMockOverDoubleCastRule, {
  valid: [
    // A typed double: the checker still sees every member.
    { code: 'const config: jest.Mocked<Pick<ConfigService, "get">> = { get: jest.fn() };' },
    { code: 'const config = { get: vi.fn() } satisfies Partial<ConfigService>;' },
    { code: 'const config = { get: jest.fn() } as jest.Mocked<Pick<ConfigService, "get">>;' },
    // No mock inside: a plain data fixture.
    { code: "const input = { id: 1, name: 'ada' } as unknown as CreateUserDto;" },
    // Settly shape: an existing double passed on, not an object of mocks.
    {
      code: 'new EteczkaRetentionService(prisma, eteczkaService as unknown as ConstructorParameters<typeof EteczkaRetentionService>[1]);',
    },
    // A single angle-bracket cast still lets the checker compare the types.
    { code: 'const svc = <jest.Mocked<Pick<MailService, "run">>>{ run: jest.fn() };', filename: 'src/mail.service.spec.ts' },
    // A single cast to unknown is not a double cast.
    { code: 'const raw = { get: jest.fn() } as unknown;' },
    // Allowed targets, by type name and by source text.
    {
      code: 'const prisma = { user: { findMany: jest.fn() } } as unknown as PrismaService;',
      options: [{ allowTargets: ['PrismaService'] }],
    },
    {
      code: 'const tx = { user: { update: vi.fn() } } as unknown as Prisma.TransactionClient;',
      options: [{ allowTargets: ['Prisma.*'] }],
    },
    {
      code: "const opts = { ctx: { res: { setHeader: jest.fn() } } } as unknown as Parameters<AppErrorHandler['onError']>[0];",
      options: [{ allowTargets: ['Parameters<*'] }],
    },
    // A factory outside the configured list.
    {
      code: 'const repo = { find: sinon.stub() } as unknown as Repository;',
    },
    { code: 'const find = sinon.stub(); const repo = { find } as unknown as Repository;' },
    // A hoisted value that is not a mock: plain data, a parameter, an import.
    { code: "const name = 'ada'; const input = { name } as unknown as CreateUserDto;" },
    { code: 'function build(get) { return { get } as unknown as ConfigService; }' },
    {
      code: "import { get } from './doubles'; const config = { get } as unknown as ConfigService;",
    },
    // A property key or a member name that matches a hoisted mock is not a reference to it.
    { code: 'const fn = vi.fn(); const input = { fn: 1 } as unknown as CreateUserDto;' },
    { code: 'const fn = vi.fn(); const input = { a: other.fn } as unknown as CreateUserDto;' },
    // A name destructured out of a mock call is not the mock itself.
    { code: 'const { fn } = vi.fn(); const input = { fn } as unknown as CreateUserDto;' },
  ],
  invalid: [
    // Settly shape: a NestJS ConfigService double.
    {
      code: `
        const config = {
          get: jest.fn((key: string) => (key === 'METRICS_BASIC_AUTH' ? basicAuth : undefined)),
        } as unknown as ConfigService;
      `,
      errors: [{ messageId: 'doubleCastMock', data: { target: 'ConfigService' }, line: 2 }],
    },
    // Settly shape: a nested mock inside a request-context stub.
    {
      code: "const opts = { ctx: { res: { setHeader: jest.fn() } } } as unknown as Parameters<AppErrorHandler['onError']>[0];",
      errors: [{ messageId: 'doubleCastMock', data: { target: "Parameters<AppErrorHandler['onError']>[0]" } }],
    },
    // Settly shape: a chained mock value.
    {
      code: "const mw = { getRawInput: jest.fn().mockResolvedValue({ foo: 'bar' }), next: jest.fn() } as unknown as MwOpts;",
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // Vitest, inside a call, and through `as any`.
    {
      code: 'render(<Form api={{ submit: vi.fn() } as unknown as FormApi} />);',
      filename: 'src/Form.test.tsx',
      errors: [{ messageId: 'doubleCastMock' }],
    },
    { code: 'const repo = { find: vi.fn() } as any as Repository;', errors: [{ messageId: 'doubleCastMock' }] },
    // A mock inside a getter function body still counts.
    {
      code: 'const host = { switchToHttp: () => ({ getResponse: () => ({ status: jest.fn() }) }) } as unknown as ArgumentsHost;',
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // Through `as never` and the angle-bracket assertion (not valid in .tsx).
    {
      code: 'const svc = { run: jest.fn() } as never as MailService;',
      errors: [{ messageId: 'doubleCastMock', data: { target: 'MailService' } }],
    },
    {
      code: 'const svc = <MailService><unknown>{ run: jest.fn() };',
      filename: 'src/mail.service.spec.ts',
      errors: [{ messageId: 'doubleCastMock', data: { target: 'MailService' } }],
    },
    {
      code: 'const svc = <MailService>({ run: vi.fn() } as unknown);',
      filename: 'src/mail.service.spec.ts',
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // A mock created first and placed in the object by name, shorthand or not.
    {
      code: `
        const fn = vi.fn();
        const svc = { fn } as unknown as Service;
      `,
      errors: [{ messageId: 'doubleCastMock', data: { target: 'Service' }, line: 3 }],
    },
    {
      code: 'const fn = jest.fn(); const svc = { run: fn } as unknown as MailService;',
      errors: [{ messageId: 'doubleCastMock', data: { target: 'MailService' } }],
    },
    // A hoisted chain, also through a cast on the initialiser.
    {
      code: "const getRawInput = jest.fn().mockResolvedValue({ foo: 'bar' }); const mw = { getRawInput } as unknown as MwOpts;",
      errors: [{ messageId: 'doubleCastMock' }],
    },
    {
      code: 'const get = vi.fn() as Mock; const config = { get } as unknown as ConfigService;',
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // A hoisted mock nested in an inner object.
    {
      code: 'const setHeader = jest.fn(); const opts = { ctx: { res: { setHeader } } } as unknown as OnErrorOptions;',
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // A binding declared first and assigned its mock in a hook.
    {
      code: `
        let get: jest.Mock;
        let config: ConfigService;
        beforeEach(() => {
          get = jest.fn();
          config = { get } as unknown as ConfigService;
        });
      `,
      errors: [{ messageId: 'doubleCastMock', line: 6 }],
    },
    // A module-level mock used inside a function.
    {
      code: `
        const send = vi.fn();
        function makeMailer() {
          return { send } as unknown as Mailer;
        }
      `,
      errors: [{ messageId: 'doubleCastMock', line: 4 }],
    },
    // A custom factory list.
    {
      code: 'const repo = { find: sinon.stub() } as unknown as Repository;',
      options: [{ mockFactories: ['sinon.stub'] }],
      errors: [{ messageId: 'doubleCastMock' }],
    },
    {
      code: 'const find = sinon.stub(); const repo = { find } as unknown as Repository;',
      options: [{ mockFactories: ['sinon.stub'] }],
      errors: [{ messageId: 'doubleCastMock' }],
    },
    // An allow glob for one type does not cover another.
    {
      code: 'const svc = { run: jest.fn() } as unknown as MailService;',
      options: [{ allowTargets: ['PrismaService'] }],
      errors: [{ messageId: 'doubleCastMock' }],
    },
  ],
});
