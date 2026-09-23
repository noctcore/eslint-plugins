import { describe, expect, test } from 'bun:test';

import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

/*
 * The /session and /trpc rules on a REAL temp tree, through the real harness
 * CLI. The fake-ctx suites cover the logic; these cover what a fake glob cannot:
 * that the real `ctx.glob` reaches the files, and that a DIRECTORY whose name
 * matches a source glob (a snapshot folder named `login.flow.ts/`) is skipped
 * instead of aborting the run with EISDIR, which the harness's `ctx.read` throws.
 */
const TIMEOUT_MS = 30_000;

const AUTH = 'apps/api/src/modules/auth/services';
/** A directory the `apps/**\/*.ts` glob matches. The file inside it keeps it on disk. */
const DIR_NAMED_LIKE_SOURCE = { 'apps/api/src/__screens__/login.flow.ts/shot.png': 'png' };

describe('session and trpc rules on a real tree', () => {
  test(
    'session-mint-callers reaches the tree and survives a directory named like a source file',
    () => {
      const run = runLintMetaOnRealTree(
        {
          ...DIR_NAMED_LIKE_SOURCE,
          [`${AUTH}/register.service.ts`]: 'this.shared.establishSession(res, { userId });\n',
          'apps/api/src/modules/auth/oauth/oauth.controller.ts': 'this.shared.establishSession(res, { userId });\n',
        },
        'createSessionMintCallersRule',
        {
          mintCall: 'establishSession',
          allowedCallers: [`${AUTH}/register.service.ts`],
          sourceGlobs: ['apps/**/*.ts'],
        },
      );

      expect(run.stderr).not.toContain('EISDIR');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(apps/api/src/modules/auth/oauth/oauth.controller.ts)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'the same run under Node with the built dist, whose glob also returns directories',
    () => {
      const run = runLintMetaOnRealTree(
        {
          ...DIR_NAMED_LIKE_SOURCE,
          'apps/api/src/modules/auth/oauth/oauth.controller.ts': 'this.shared.establishSession(res, { userId });\n',
        },
        'createSessionMintCallersRule',
        { mintCall: 'establishSession', sourceGlobs: ['apps/**/*.ts'] },
        { runtime: 'node-eslint9' },
      );

      expect(run.stderr).not.toContain('EISDIR');
      expect(run.violations).toHaveLength(1);
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'session-kind-stamped bites on a real tree',
    () => {
      const run = runLintMetaOnRealTree(
        {
          ...DIR_NAMED_LIKE_SOURCE,
          [`${AUTH}/login.service.ts`]: 'this.shared.establishSession(res, { userId });\n',
        },
        'createSessionKindStampedRule',
        { mintCall: 'establishSession', sourceGlobs: ['apps/**/*.ts'] },
      );

      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain(`(${AUTH}/login.service.ts)`);
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'session-epoch-captured bites on a real tree',
    () => {
      const run = runLintMetaOnRealTree(
        { ...DIR_NAMED_LIKE_SOURCE, [`${AUTH}/login.service.ts`]: 'this.challenge.beginOrEstablish(user, { res });\n' },
        'createSessionEpochCapturedRule',
        { call: 'beginOrEstablish', sourceGlobs: ['apps/**/*.ts'] },
      );

      expect(run.violations).toHaveLength(1);
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'session-landing-declared bites on a real tree, both ways',
    () => {
      const run = runLintMetaOnRealTree(
        {
          ...DIR_NAMED_LIKE_SOURCE,
          [`${AUTH}/magic-link.service.ts`]: 'this.shared.establishSession(res, { kind });\n',
        },
        'createSessionLandingDeclaredRule',
        {
          doorCalls: ['establishSession'],
          doors: [{ file: `${AUTH}/login.service.ts`, landing: 'login-result', because: 'sign-in' }],
          landings: { 'login-result': 'Promise<ILoginResult>' },
          sourceGlobs: ['apps/**/*.ts'],
        },
      );

      expect(run.violations.sort()).toEqual([
        expect.stringContaining(`(${AUTH}/login.service.ts)`),
        expect.stringContaining(`(${AUTH}/magic-link.service.ts)`),
      ]);
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );

  test(
    'idempotency-key-parity bites on a real tree',
    () => {
      const run = runLintMetaOnRealTree(
        {
          'apps/api/src/example.router.ts':
            "@Router({ alias: 'example' })\nclass R {\n  @UseMiddlewares(IdempotencyMiddleware)\n  async create() {}\n}\n",
          'apps/web/src/use-create.tsx': 'trpc.example.create.useMutation();\n',
          'apps/web/src/__screens__/form.test.tsx/shot.png': 'png',
        },
        'createIdempotencyKeyParityRule',
        {
          middleware: 'IdempotencyMiddleware',
          routerGlobs: ['apps/api/src/**/*.router.ts'],
          clientGlobs: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
        },
      );

      expect(run.stderr).not.toContain('EISDIR');
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0]).toContain('(apps/api/src/example.router.ts)');
      expect(run.code).toBe(1);
    },
    TIMEOUT_MS,
  );
});
