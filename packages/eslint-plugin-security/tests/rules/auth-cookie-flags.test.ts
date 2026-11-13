import { ruleTester } from '@noctcore/eslint-test-utils';

import { authCookieFlagsRule } from '../../src/rules/auth-cookie-flags';

const TS = 'auth.ts';

type Flag = 'httpOnly' | 'secure' | 'sameSite';

function missing(cookie: string, ...flags: Flag[]) {
  return flags.map((flag) => ({ messageId: 'missingFlag' as const, data: { cookie, flag } }));
}

function weak(cookie: string, ...flags: Flag[]) {
  return flags.map((flag) => ({ messageId: 'weakFlag' as const, data: { cookie, flag } }));
}

function noneNeedsSecure(cookie: string) {
  return [{ messageId: 'sameSiteNoneNeedsSecure' as const, data: { cookie } }];
}

const ALL: Flag[] = ['httpOnly', 'secure', 'sameSite'];

/** `res.cookie('session', t, { httpOnly: true, secure: true, sameSite: 'lax' })` with one property changed. */
function base(overrides: Partial<Record<Flag, string>>): string {
  const props = { httpOnly: 'true', secure: 'true', sameSite: "'lax'", ...overrides };
  const body = Object.entries(props)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  return `res.cookie('session', t, { ${body} });`;
}

ruleTester.run('auth-cookie-flags', authCookieFlagsRule, {
  valid: [
    // Every flag set as required.
    { code: base({}), filename: TS },
    { code: `cookie.session.set({ value: t, httpOnly: true, secure: true, sameSite: 'strict' });`, filename: TS },
    { code: `cookies().set('session', t, { httpOnly: true, secure: true, sameSite: 'lax' });`, filename: TS },
    // A non-literal secure is accepted on trust.
    {
      code: `reply.setCookie('session', token, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });`,
      filename: TS,
    },
    // sameSite is compared case-insensitively, and a non-literal is accepted on trust.
    { code: base({ sameSite: "'Strict'" }), filename: TS },
    { code: base({ sameSite: 'policy' }), filename: TS },
    { code: base({ sameSite: "'none'" }), filename: TS },
    // A computed static key counts as the flag.
    { code: `res.cookie('session', t, { ['httpOnly']: true, secure: true, sameSite: 'lax' });`, filename: TS },
    // A name that is not an auth cookie name.
    { code: `res.cookie('theme', v);`, filename: TS },
    // A non-literal cookie name.
    { code: `res.cookie(name, v);`, filename: TS },
    // A set call on any other receiver.
    { code: `map.set('session', v);`, filename: TS },
    // A bare setCookie call is not one of the read shapes.
    { code: `setCookie('session', token);`, filename: TS },
    // An aliased cookie store is not followed.
    { code: `const store = cookies(); store.set('session', t);`, filename: TS },
    // A spread in the argument list cannot be counted.
    { code: `res.cookie('session', t, ...args);`, filename: TS },
    // A trusted config, spread or passed whole.
    {
      code: `set('sid', id, { ...AUTH_COOKIE_CONFIG });`,
      filename: TS,
      options: [{ trustedConfigNames: ['AUTH_COOKIE_CONFIG'] }],
    },
    {
      code: `res.cookie('session', t, config.cookie);`,
      filename: TS,
      options: [{ trustedConfigNames: ['config.cookie'] }],
    },
    {
      code: `res.cookie('session', t, { ...cookieOptions() });`,
      filename: TS,
      options: [{ trustedConfigNames: ['cookieOptions()'] }],
    },
    // A trusted spread satisfies the secure that sameSite 'none' needs.
    {
      code: `res.cookie('session', t, { ...AUTH_COOKIE_CONFIG, sameSite: 'none' });`,
      filename: TS,
      options: [{ trustedConfigNames: ['AUTH_COOKIE_CONFIG'] }],
    },
    // A configured authCookieNames replaces the default list.
    { code: `res.cookie('session', t);`, filename: TS, options: [{ authCookieNames: ['jwt'] }] },
    {
      code: `res.cookie('jwt', t, { httpOnly: true });`,
      filename: TS,
      options: [{ require: ['httpOnly'], authCookieNames: ['jwt'] }],
    },
  ],
  invalid: [
    // The five shapes.
    { code: `cookie.session.set({ value: t });`, filename: TS, errors: missing('session', ...ALL) },
    { code: `cookie['auth_token'].set({ value: t });`, filename: TS, errors: missing('auth_token', ...ALL) },
    {
      code: `set('sid', id, { httpOnly: true, secure: true });`,
      filename: TS,
      errors: missing('sid', 'sameSite'),
    },
    { code: `reply.setCookie('session', token);`, filename: TS, errors: missing('session', ...ALL) },
    {
      code: `res.cookie('auth_token', token, { httpOnly: false, secure: true, sameSite: 'lax' });`,
      filename: TS,
      errors: weak('auth_token', 'httpOnly'),
    },
    {
      code: `cookies().set('session', t, { secure: true, sameSite: 'lax' });`,
      filename: TS,
      errors: missing('session', 'httpOnly'),
    },
    {
      code: `async function f() { (await cookies()).set('session', t, { secure: true, sameSite: 'lax' }); }`,
      filename: TS,
      errors: missing('session', 'httpOnly'),
    },
    // A static template literal name is still the name.
    { code: 'res.cookie(`authToken`, t);', filename: TS, errors: missing('authToken', ...ALL) },
    // Flag semantics.
    { code: base({ httpOnly: 'flag' }), filename: TS, errors: weak('session', 'httpOnly') },
    { code: base({ httpOnly: 'undefined' }), filename: TS, errors: missing('session', 'httpOnly') },
    { code: base({ secure: 'false' }), filename: TS, errors: weak('session', 'secure') },
    { code: base({ sameSite: "'loose'" }), filename: TS, errors: weak('session', 'sameSite') },
    { code: base({ sameSite: 'true' }), filename: TS, errors: weak('session', 'sameSite') },
    {
      code: `res.cookie('session', t, { httpOnly: true, secure: isProd, sameSite: 'none' });`,
      filename: TS,
      errors: noneNeedsSecure('session'),
    },
    {
      code: `res.cookie('session', t, { httpOnly: true, sameSite: 'none' });`,
      filename: TS,
      errors: missing('session', 'secure'),
    },
    {
      code: `res.cookie('session', t, { httpOnly: true, sameSite: 'none' });`,
      filename: TS,
      options: [{ require: ['httpOnly', 'sameSite'] }],
      errors: noneNeedsSecure('session'),
    },
    // An untrusted spread or options value sets nothing.
    {
      code: `set('sid', id, { ...AUTH_COOKIE_CONFIG });`,
      filename: TS,
      errors: missing('sid', ...ALL),
    },
    {
      code: `res.cookie('session', t, cookieOptions);`,
      filename: TS,
      errors: missing('session', ...ALL),
    },
    // A flag written next to a trusted spread overrides it.
    {
      code: `set('sid', id, { ...AUTH_COOKIE_CONFIG, httpOnly: false });`,
      filename: TS,
      options: [{ trustedConfigNames: ['AUTH_COOKIE_CONFIG'] }],
      errors: weak('sid', 'httpOnly'),
    },
    {
      code: `set('sid', id, { ...AUTH_COOKIE_CONFIG, secure: undefined });`,
      filename: TS,
      options: [{ trustedConfigNames: ['AUTH_COOKIE_CONFIG'] }],
      errors: missing('sid', 'secure'),
    },
    // Options.
    {
      code: `res.cookie('session', t, {});`,
      filename: TS,
      options: [{ require: ['httpOnly'] }],
      errors: missing('session', 'httpOnly'),
    },
    {
      code: `res.cookie('jwt', t);`,
      filename: TS,
      options: [{ authCookieNames: ['jwt'] }],
      errors: missing('jwt', ...ALL),
    },
    {
      code: `res.cookie('refresh_token', t);`,
      filename: TS,
      options: [{ authCookiePattern: '^refresh_' }],
      errors: missing('refresh_token', ...ALL),
    },
    {
      code: `res.cookie('session', t);`,
      filename: TS,
      options: [{ authCookiePattern: '^refresh_' }],
      errors: missing('session', ...ALL),
    },
  ],
});
