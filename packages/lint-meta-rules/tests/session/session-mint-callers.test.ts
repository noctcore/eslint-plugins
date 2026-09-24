import { describe, expect, test } from 'bun:test';

import { createSessionMintCallersRule, type SessionMintCallersOptions } from '../../src/session';
import { createFakeCtx, type FakeFiles } from '../test-utils/createFakeCtx';

/*
 * Every case of Settly's `establish-session-callers` suite, ported, run with the
 * options Settly passes. The rest pin the generalisation: nothing is inert by
 * accident, and nothing Settly-shaped is baked in.
 */
const AUTH = 'apps/api/src/modules/auth/services';
const SETTLY: SessionMintCallersOptions = {
  mintCall: 'establishSession',
  gateCall: 'beginOrEstablish',
  allowedCallers: [
    `${AUTH}/auth-shared.service.ts`,
    `${AUTH}/two-factor-challenge.service.ts`,
    `${AUTH}/register.service.ts`,
    `${AUTH}/password-change.service.ts`,
    `${AUTH}/session-management.service.ts`,
  ],
  sourceGlobs: ['apps/**/*.ts', 'apps/**/*.tsx'],
};

const CALL = 'await this.shared.establishSession(res, { userId });\n';

function run(files: FakeFiles, options: SessionMintCallersOptions = SETTLY) {
  return createSessionMintCallersRule(options).run!(createFakeCtx({ files }));
}

describe('session-mint-callers', () => {
  test('reports a login entry point that mints a session directly', () => {
    const violations = run({ 'apps/api/src/modules/auth/oauth/oauth.controller.ts': CALL });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('session-mint-callers');
    expect(violations[0]?.message).toMatch(/beginOrEstablish/u);
    expect(violations[0]?.file).toBe('apps/api/src/modules/auth/oauth/oauth.controller.ts');
  });

  test('passes each allowlisted flow', () => {
    const files = Object.fromEntries((SETTLY.allowedCallers ?? []).map((file) => [file, CALL]));

    expect(run(files)).toEqual([]);
  });

  test('does not treat a same-named file in another directory as allowlisted', () => {
    expect(run({ 'apps/api/src/modules/other/services/register.service.ts': CALL })).toHaveLength(1);
  });

  test('ignores specs and the method definition itself', () => {
    const violations = run({
      'apps/api/src/modules/auth/login.spec.ts': CALL,
      'apps/api/src/modules/auth/login.test.ts': CALL,
      'apps/web/src/session.test.tsx': CALL,
      'apps/api/src/modules/auth/definition.ts':
        'export class X {\n  async establishSession(res: unknown) {}\n}\n',
    });

    expect(violations).toEqual([]);
  });

  test('catches a call split across a newline before the paren', () => {
    expect(run({ 'apps/api/src/modules/auth/new-flow.ts': 'this.shared.establishSession\n  (res, {});\n' })).toHaveLength(1);
  });

  test('is inert with no mintCall, whatever the tree holds', () => {
    expect(run({ 'apps/api/src/a.ts': CALL }, { sourceGlobs: ['apps/**/*.ts'] })).toEqual([]);
  });

  test('reads only sourceGlobs, so a rule module quoting the call is not a caller', () => {
    expect(run({ 'tools/lint-meta/rule.ts': CALL })).toEqual([]);
  });

  test('skips skipDirs segments', () => {
    expect(run({ 'apps/api/dist/modules/auth/login.ts': CALL })).toEqual([]);
  });

  test('takes any method name and id, and appends the hint', () => {
    const violations = run(
      { 'server/login.ts': 'session.mint(user)' },
      { id: 'mint-fence', mintCall: 'mint', sourceGlobs: ['server/**/*.ts'], hint: 'See AUTH.md.' },
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('mint-fence');
    expect(violations[0]?.message).toMatch(/^mint\(\) may only be called/u);
    expect(violations[0]?.message).toMatch(/See AUTH\.md\.$/u);
    expect(violations[0]?.message).not.toMatch(/instead/u);
  });
});
