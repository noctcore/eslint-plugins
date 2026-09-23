import { describe, expect, test } from 'bun:test';

import { createSessionKindStampedRule, type SessionKindStampedOptions } from '../../src/session';
import { createFakeCtx, type FakeFiles } from '../test-utils/createFakeCtx';

/* Every case of Settly's `session-kind-stamped` suite, ported, with Settly's options. */
const AUTH = 'apps/api/src/modules/auth/services';
const FILE = `${AUTH}/password-change.service.ts`;
const SETTLY: SessionKindStampedOptions = {
  mintCall: 'establishSession',
  field: 'kind',
  allowUnstamped: [`${AUTH}/register.service.ts`],
  sourceGlobs: ['apps/**/*.ts', 'apps/**/*.tsx'],
};

function run(files: FakeFiles, options: SessionKindStampedOptions = SETTLY) {
  return createSessionKindStampedRule(options).run!(createFakeCtx({ files }));
}

describe('session-kind-stamped', () => {
  test('reports a hand-written options literal that never mentions kind', () => {
    const violations = run({
      [FILE]: 'await this.shared.establishSession(res, {\n  userId: user.id,\n  tenantId: user.tenantId,\n});\n',
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('session-kind-stamped');
    expect(violations[0]?.message).toMatch(/allowUnstamped/u);
  });

  test('passes a literal that spreads the kind', () => {
    const violations = run({
      [FILE]:
        "await this.shared.establishSession(res, {\n  userId: user.id,\n  ...(user.kind === 'PORTAL' ? { kind: 'PORTAL' as const } : {}),\n});\n",
    });

    expect(violations).toEqual([]);
  });

  test('checks each literal on its own: one stamped mint does not excuse an unstamped one', () => {
    const violations = run({
      [FILE]: [
        'await this.shared.establishSession(res, { userId: a, kind: user.kind });',
        'await this.shared.establishSession(res, { userId: b });',
        '',
      ].join('\n'),
    });

    expect(violations).toHaveLength(1);
  });

  test('accepts delegated options when the file stamps kind somewhere', () => {
    const violations = run({
      [FILE]: 'const params = { kind: user.kind };\nawait this.shared.establishSession(res, params);\n',
    });

    expect(violations).toEqual([]);
  });

  test('reports delegated options in a file that never stamps kind', () => {
    expect(run({ [FILE]: 'await this.shared.establishSession(res, params);\n' })).toHaveLength(1);
  });

  test('balances nested parentheses, so a kind after an inner call still counts', () => {
    const violations = run({
      [FILE]:
        'await this.shared.establishSession(res, {\n  userId: normalise(user.id),\n  kind: pick(user).kind,\n});\n',
    });

    expect(violations).toEqual([]);
  });

  test('does not confuse establishSessionSomething with the mint', () => {
    expect(run({ [FILE]: 'await this.shared.establishSessionLater(res, { userId });\n' })).toEqual([]);
  });

  test('exempts only the provably staff-only self-signup mint', () => {
    const kindless = 'await this.shared.establishSession(res, { userId });\n';

    expect(run({ [`${AUTH}/register.service.ts`]: kindless })).toEqual([]);
    expect(run({ [`${AUTH}/login.service.ts`]: kindless })).toHaveLength(1);
  });

  test('skips specs', () => {
    expect(run({ [`${AUTH}/login.service.spec.ts`]: 'await this.shared.establishSession(res, { userId });\n' })).toEqual([]);
  });

  test('is inert with no mintCall', () => {
    expect(run({ [FILE]: 'this.shared.establishSession(res, {});' }, { sourceGlobs: ['apps/**/*.ts'] })).toEqual([]);
  });

  test('takes another field, and quotes the stamp example', () => {
    const options: SessionKindStampedOptions = {
      mintCall: 'createSession',
      field: 'audience',
      stampExample: 'audience: user.audience',
      sourceGlobs: ['src/**/*.ts'],
    };

    const violations = run({ 'src/login.ts': 'sessions.createSession({ userId, kind })' }, options);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('`audience: user.audience`');
    expect(run({ 'src/login.ts': 'sessions.createSession({ userId, audience })' }, options)).toEqual([]);
  });
});
