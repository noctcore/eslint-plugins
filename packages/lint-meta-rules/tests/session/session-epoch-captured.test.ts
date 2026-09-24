import { describe, expect, test } from 'bun:test';

import { createSessionEpochCapturedRule, type SessionEpochCapturedOptions } from '../../src/session';
import { createFakeCtx, type FakeFiles } from '../test-utils/createFakeCtx';

/* Every case of Settly's `session-epoch-captured` suite, ported, with Settly's options. */
const AUTH = 'apps/api/src/modules/auth/services';
const FILE = `${AUTH}/login.service.ts`;
const SETTLY: SessionEpochCapturedOptions = {
  call: 'beginOrEstablish',
  field: 'epoch',
  exempt: [`${AUTH}/two-factor-challenge.service.ts`],
  captureCall: 'sessionService.readEpoch(userId)',
  excludeSuffixes: ['.spec.ts', '.test.ts'],
  sourceGlobs: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'tools/**/*.ts'],
};

function callSource(args: string): string {
  return `export class LoginService {\n  async login() {\n    return this.challenge.beginOrEstablish(\n${args}\n    );\n  }\n}\n`;
}

function run(files: FakeFiles, options: SessionEpochCapturedOptions = SETTLY) {
  return createSessionEpochCapturedRule(options).run!(createFakeCtx({ files }));
}

describe('session-epoch-captured', () => {
  test('reports a call that never mentions the epoch', () => {
    const violations = run({ [FILE]: callSource('      user,\n      { userId: user.id, res }') });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('session-epoch-captured');
    expect(violations[0]?.message).toMatch(/readEpoch/u);
  });

  test('passes a call that threads the captured epoch through', () => {
    expect(run({ [FILE]: callSource('      user,\n      { userId: user.id, res, epoch }') })).toEqual([]);
  });

  test('reports each call on its own, so one stamped call does not cover another', () => {
    expect(run({ [FILE]: `${callSource('      { epoch }')}${callSource('      { res }')}` })).toHaveLength(1);
  });

  test('does not accept the word epoch inside another identifier', () => {
    expect(run({ [FILE]: callSource('      { userId: user.id, epochless: true }') })).toHaveLength(1);
  });

  test('skips the seam itself and specs', () => {
    const noEpoch = callSource('      { res }');
    const violations = run({
      [`${AUTH}/two-factor-challenge.service.ts`]: noEpoch,
      [`${AUTH}/login.service.spec.ts`]: noEpoch,
      [`${AUTH}/login.service.test.ts`]: noEpoch,
    });

    expect(violations).toEqual([]);
  });

  test('catches a single-line call, which a regex anchored on a closing line missed', () => {
    const violations = run({
      [FILE]: [
        'await this.challenge.beginOrEstablish(user, { res });',
        'await this.challenge.beginOrEstablish(',
        '  user, { res, epoch },',
        ');',
        '',
      ].join('\n'),
    });

    expect(violations).toHaveLength(1);
  });

  test('is inert with no call', () => {
    expect(run({ [FILE]: callSource('{ res }') }, { sourceGlobs: ['apps/**/*.ts'] })).toEqual([]);
  });

  test('takes another seam and field', () => {
    const options: SessionEpochCapturedOptions = {
      call: 'finishSignIn',
      field: 'generation',
      sourceGlobs: ['src/**/*.ts'],
    };

    expect(run({ 'src/a.ts': 'auth.finishSignIn(user, { epoch })' }, options)).toHaveLength(1);
    expect(run({ 'src/a.ts': 'auth.finishSignIn(user, { generation })' }, options)).toEqual([]);
  });
});
