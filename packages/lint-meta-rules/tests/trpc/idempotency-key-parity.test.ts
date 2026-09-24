import { describe, expect, test } from 'bun:test';

import { createIdempotencyKeyParityRule, type IdempotencyKeyParityOptions } from '../../src/trpc';
import { createFakeCtx, type FakeFiles } from '../test-utils/createFakeCtx';

/* Every case of Settly's `idempotency-key-parity` suite, ported, with Settly's options. */
const ROUTER = 'apps/api/src/modules/example/example.router.ts';
const WEB = 'apps/web/src/features/example/useCreateExample.ts';

const SETTLY: IdempotencyKeyParityOptions = {
  middleware: 'IdempotencyMiddleware',
  keyToken: 'idempotencyKey',
  routerGlobs: ['apps/api/src/**/*.router.ts'],
  clientGlobs: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
};

const ROUTER_SOURCE = `
  @Router({ alias: 'example' })
  export class ExampleRouter {
    @Mutation({ input: createInput, output: createOutput })
    @UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)
    async create() { return {}; }

    @Mutation({ input: removeInput, output: removeOutput })
    @UseMiddlewares(AuthMiddleware)
    async remove() { return {}; }
  }
`;

function run(files: FakeFiles, options: IdempotencyKeyParityOptions = SETTLY) {
  return createIdempotencyKeyParityRule(options).run!(createFakeCtx({ files }));
}

describe('idempotency-key-parity', () => {
  test('reports a guarded procedure whose web caller never sends a key', () => {
    const violations = run({
      [ROUTER]: ROUTER_SOURCE,
      [WEB]: 'export const useCreate = () => trpc.example.create.useMutation();\n',
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('idempotency-key-parity');
    expect(violations[0]?.file).toBe(ROUTER);
    expect(violations[0]?.message).toMatch(/`example\.create` carries IdempotencyMiddleware/u);
  });

  test('passes when a web file names the procedure and threads idempotencyKey', () => {
    const violations = run({
      [ROUTER]: ROUTER_SOURCE,
      [WEB]:
        'export const useCreate = (idempotencyKey: string) =>\n  trpc.example.create.mutationOptions({ trpc: { context: { idempotencyKey } } });\n',
    });

    expect(violations).toEqual([]);
  });

  test('passes a guarded procedure that has no web caller yet', () => {
    expect(run({ [ROUTER]: ROUTER_SOURCE })).toEqual([]);
  });

  test('does not police procedures that carry no idempotency middleware', () => {
    const violations = run({
      [ROUTER]: ROUTER_SOURCE,
      [WEB]: 'trpc.example.remove.useMutation();\ntrpc.example.create.idempotencyKey;\n',
    });

    expect(violations).toEqual([]);
  });

  test('accepts a key sent from a different web file than the one naming the call', () => {
    const violations = run({
      [ROUTER]: ROUTER_SOURCE,
      [WEB]: 'trpc.example.create.useMutation();\n',
      'apps/web/src/features/example/other.ts': 'trpc.example.create.mutationOptions({ idempotencyKey });\n',
    });

    expect(violations).toEqual([]);
  });

  test('reports each unkeyed procedure, not just the first', () => {
    const violations = run({
      [ROUTER]: `
        @Router({ alias: 'example' })
        export class ExampleRouter {
          @UseMiddlewares(IdempotencyMiddleware)
          async create() { return {}; }
          @UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)
          async update() { return {}; }
        }
      `,
      [WEB]: 'trpc.example.create.useMutation();\ntrpc.example.update.useMutation();\n',
    });

    expect(violations).toHaveLength(2);
  });

  test('ignores non-router files and routers outside the router globs', () => {
    const violations = run({
      'apps/api/src/modules/example/example.service.ts': ROUTER_SOURCE,
      'packages/shared/src/example.router.ts': ROUTER_SOURCE,
      [WEB]: 'trpc.example.create.useMutation();\n',
    });

    expect(violations).toEqual([]);
  });

  test('honours exempt procedures', () => {
    const violations = run(
      { [ROUTER]: ROUTER_SOURCE, [WEB]: 'trpc.example.create.useMutation();\n' },
      { ...SETTLY, exempt: ['example.create'] },
    );

    expect(violations).toEqual([]);
  });

  test('does not take a longer middleware name for the configured one', () => {
    const violations = run({
      [ROUTER]: ROUTER_SOURCE.replace('IdempotencyMiddleware', 'IdempotencyMiddlewareLegacy'),
      [WEB]: 'trpc.example.create.useMutation();\n',
    });

    expect(violations).toEqual([]);
  });

  test('is inert with no middleware', () => {
    const files = { [ROUTER]: ROUTER_SOURCE, [WEB]: 'trpc.example.create.useMutation();\n' };

    expect(run(files, { routerGlobs: SETTLY.routerGlobs, clientGlobs: SETTLY.clientGlobs })).toEqual([]);
  });

  test('takes another decorator shape, client prefix and key token', () => {
    const options: IdempotencyKeyParityOptions = {
      middleware: 'DedupeGuard',
      keyToken: 'requestId',
      clientPrefix: 'api.',
      routerDecorator: 'Controller',
      aliasKey: 'name',
      middlewareDecorator: 'Guards',
      routerGlobs: ['server/**/*.ts'],
      clientGlobs: ['client/**/*.ts'],
    };
    const router = `@Controller({ name: "orders" })\nclass O {\n  @Guards(DedupeGuard)\n  async place() {}\n}\n`;

    expect(run({ 'server/orders.ts': router, 'client/a.ts': 'api.orders.place()' }, options)).toHaveLength(1);
    expect(run({ 'server/orders.ts': router, 'client/a.ts': 'api.orders.place({ requestId })' }, options)).toEqual([]);
  });
});
