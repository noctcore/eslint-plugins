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
    // A custom factory list.
    {
      code: 'const repo = { find: sinon.stub() } as unknown as Repository;',
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
