import { describe, expect, test } from 'bun:test';

import {
  createSessionLandingDeclaredRule,
  type SessionDoor,
  type SessionLandingDeclaredOptions,
} from '../../src/session';
import { createFakeCtx, type FakeFiles } from '../test-utils/createFakeCtx';

/* Every case of Settly's `session-landing-declared` suite, ported, with Settly's options. */
const AUTH = 'apps/api/src/modules/auth';

const DOORS: readonly SessionDoor[] = [
  { file: `${AUTH}/services/login.service.ts`, landing: 'login-result', because: 'password sign-in' },
  { file: `${AUTH}/services/two-factor-challenge.service.ts`, landing: 'login-result', because: 'second door' },
  { file: `${AUTH}/oauth/oauth.controller.ts`, landing: 'staff-only', because: 'refuses portal accounts' },
  { file: `${AUTH}/services/register.service.ts`, landing: 'staff-only', because: 'self-signup mints an owner' },
  { file: `${AUTH}/services/password-change.service.ts`, landing: 'reissue', because: 'caller holds a session' },
  { file: `${AUTH}/services/session-management.service.ts`, landing: 'reissue', because: 'revokeOthers re-issues' },
];

const SETTLY: SessionLandingDeclaredOptions = {
  doorCalls: ['establishSession', 'beginOrEstablish'],
  doors: DOORS,
  landings: { 'login-result': 'Promise<ILoginResult>', reissue: null, 'staff-only': null },
  sourceGlobs: ['apps/**/*.ts', 'apps/**/*.tsx'],
};

const MINT = 'await this.shared.establishSession(res, { userId, kind });\n';
const LOGIN_RESULT_MINT = `export class X {\n  async run(): Promise<ILoginResult> {\n    ${MINT}  }\n}\n`;

/** One well-formed file per declared door: login-result doors return the union. */
function doors(overrides: Readonly<Record<string, string | null>> = {}): FakeFiles {
  const files: FakeFiles = {
    [`${AUTH}/services/login.service.ts`]: LOGIN_RESULT_MINT,
    [`${AUTH}/services/two-factor-challenge.service.ts`]: LOGIN_RESULT_MINT,
    [`${AUTH}/oauth/oauth.controller.ts`]: MINT,
    [`${AUTH}/services/register.service.ts`]: MINT,
    [`${AUTH}/services/password-change.service.ts`]: MINT,
    [`${AUTH}/services/session-management.service.ts`]: MINT,
  };
  for (const [file, content] of Object.entries(overrides)) {
    if (content === null) delete files[file];
    else files[file] = content;
  }
  return files;
}

function run(files: FakeFiles, options: SessionLandingDeclaredOptions = SETTLY) {
  return createSessionLandingDeclaredRule(options).run!(createFakeCtx({ files }));
}

describe('session-landing-declared', () => {
  test('passes when every door is declared and login-result doors return the union', () => {
    expect(run(doors())).toEqual([]);
  });

  test('reports a new file that opens a door into a session without declaring it', () => {
    const violations = run({
      ...doors(),
      [`${AUTH}/services/magic-link.service.ts`]: 'await this.challenge.beginOrEstablish(user, { epoch });\n',
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('session-landing-declared');
    expect(violations[0]?.file).toBe(`${AUTH}/services/magic-link.service.ts`);
    expect(violations[0]?.message).toMatch(/does not declare where it leaves the caller/u);
  });

  test('reports a login-result door that stopped returning ILoginResult', () => {
    const violations = run(doors({ [`${AUTH}/services/login.service.ts`]: `async run() {\n  ${MINT}}\n` }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(`${AUTH}/services/login.service.ts`);
    expect(violations[0]?.message).toMatch(/declared `login-result` but its source never contains `Promise<ILoginResult>`/u);
  });

  test('does not demand ILoginResult from a reissue or staff-only door', () => {
    // password-change (reissue) and register (staff-only) return nothing typed.
    expect(run(doors())).toEqual([]);
  });

  test('reports a declared door that no longer exists, so the list cannot go stale', () => {
    const violations = run(doors({ [`${AUTH}/services/register.service.ts`]: null }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(`${AUTH}/services/register.service.ts`);
    expect(violations[0]?.message).toMatch(/names a file that no longer exists/u);
  });

  test('ignores specs, which drive both doors directly', () => {
    const violations = run({
      ...doors(),
      [`${AUTH}/services/magic-link.service.spec.ts`]: MINT,
      [`${AUTH}/services/magic-link.service.test.ts`]: MINT,
    });

    expect(violations).toEqual([]);
  });

  test('ignores a file that merely defines the method', () => {
    const violations = run({
      ...doors(),
      [`${AUTH}/services/auth-shared.service.ts`]: 'export class A {\n  async establishSession(res: unknown) {}\n}\n',
    });

    expect(violations).toEqual([]);
  });

  test('reports a door declared with a landing that is not configured', () => {
    const options: SessionLandingDeclaredOptions = {
      ...SETTLY,
      doors: DOORS.map((door) => (door.landing === 'reissue' ? { ...door, landing: 're-issue' } : door)),
    };

    const violations = run(doors(), options);

    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toMatch(/landing `re-issue`, which is not one of the configured landings/u);
  });

  test('reports a door declared with an empty because', () => {
    const options: SessionLandingDeclaredOptions = {
      ...SETTLY,
      doors: DOORS.map((door, index) => (index === 0 ? { ...door, because: '  ' } : door)),
    };

    const violations = run(doors(), options);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/empty `because`/u);
  });

  test('reports a door the globs do not reach, rather than trusting a misconfiguration', () => {
    const violations = run(doors(), { ...SETTLY, sourceGlobs: ['apps/**/services/*.ts'] });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(`${AUTH}/oauth/oauth.controller.ts`);
  });

  test('is inert with no doorCalls', () => {
    expect(run({ 'apps/a.ts': MINT }, { sourceGlobs: ['apps/**/*.ts'], doors: DOORS })).toEqual([]);
  });
});
