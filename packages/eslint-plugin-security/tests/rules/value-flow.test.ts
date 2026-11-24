import { ruleTester } from '@noctcore/eslint-test-utils';

import { authCookieFlagsRule } from '../../src/rules/auth-cookie-flags';
import { noShellInterpolationRule } from '../../src/rules/no-shell-interpolation';
import { noUnescapedHtmlResponseRule } from '../../src/rules/no-unescaped-html-response';
import { noUserControlledFetchUrlRule } from '../../src/rules/no-user-controlled-fetch-url';
import { noUserControlledRedirectRule } from '../../src/rules/no-user-controlled-redirect';
import { requirePathContainmentRule } from '../../src/rules/require-path-containment';
import { requireSanitizedHtmlRule } from '../../src/rules/require-sanitized-html';

// Each rule must judge a value the same way when the code only moves it
// around: through a helper, an object, an array, a destructuring, a spread,
// a promise or a callback. One case per move, per rule.

const TS = 'handler.ts';
const TSX = 'component.tsx';

/** An identity helper, declared after its use. */
const FORWARD = 'function forward(x) { return x; }';

type Sink = (expression: string) => string;

/** The moves that hand `value` to `sink` unchanged. */
const MOVES: Record<string, (value: string, sink: Sink) => string> = {
  'via-variable': (value, sink) => `const relay = ${value}; ${sink('relay')}`,
  'via-helper': (value, sink) => `${sink(`forward(${value})`)}`,
  'via-object': (value, sink) => `const holder = { value: ${value} }; ${sink('holder.value')}`,
  'via-destructuring': (value, sink) => `const { value: picked } = { value: ${value} }; ${sink('picked')}`,
  'via-array': (value, sink) => `const items = [${value}]; ${sink('items[0]')}`,
  'promise-await': (value, sink) => `const relay = await Promise.resolve(${value}); ${sink('relay')}`,
  'promise-then': (value, sink) => `Promise.resolve(${value}).then((relay) => { ${sink('relay')} });`,
  callback: (value, sink) => `[${value}].forEach((relay) => { ${sink('relay')} });`,
};

/** One case per named move, each built by `wrap` around the moved body. */
function moved(names: readonly string[], value: string, sink: Sink, wrap: (body: string) => string): string[] {
  return names.map((name) => `${wrap(MOVES[name]!(value, sink))} ${FORWARD}`);
}

const shellGuarded = (body: string): string =>
  `import { exec } from 'node:child_process'; const ALLOWED = ['logo.png', 'banner.png']; async function h(file) { if (!ALLOWED.includes(file)) return; ${body} }`;

ruleTester.run('no-shell-interpolation (value flow)', noShellInterpolationRule, {
  valid: moved(
    ['via-helper', 'via-object', 'via-destructuring', 'via-array', 'promise-await', 'promise-then', 'callback'],
    'file',
    (e) => `exec(\`convert \${${e}}\`);`,
    shellGuarded,
  ).map((code) => ({ code, filename: TS })),
  invalid: [
    // An import bound to another name is still the runner.
    {
      code: "import { execSync as run } from 'node:child_process'; function h(req) { run(`nslookup ${req.params.domain}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `'cmd '.concat(x)` builds the command like `+`.
    {
      code: "import { execSync } from 'node:child_process'; function h(req) { execSync('nslookup '.concat(req.params.domain)); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
  ],
});

const redirectGuarded = (body: string): string =>
  `const HOSTS = ['app.example.com']; async function h(req, res) { const next = String(req.query.next); if (!HOSTS.includes(new URL(next).hostname)) return; ${body} }`;

ruleTester.run('no-user-controlled-redirect (value flow)', noUserControlledRedirectRule, {
  valid: moved(
    ['via-helper', 'via-object', 'via-array', 'promise-await', 'promise-then', 'callback'],
    'next',
    (e) => `res.redirect(${e});`,
    redirectGuarded,
  )
    .concat(
      // The guard's boolean is moved into an object before the test reads it.
      "function h(req, res) { const path = String(req.query.path); const fixed = path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\\\'); const holder = { value: fixed }; res.setHeader('Location', 'https://app.example.com' + (holder.value ? path : '/')); }",
    )
    .map((code) => ({ code, filename: TS })),
  invalid: [
    // The response is found by its place in a route handler, not by its name.
    {
      code: "app.get('/login', (param1, param2) => { param2.redirect(param1.query.returnTo || '/'); });",
      filename: TS,
      errors: [{ messageId: 'userControlledRedirect' }],
    },
    // A spread of an array literal is the argument itself.
    {
      code: 'function h(req, res) { res.redirect(...[req.query.next]); }',
      filename: TS,
      errors: [{ messageId: 'userControlledRedirect' }],
    },
  ],
});

const fetchGuarded = (body: string): string =>
  `const HOSTS = ['api.example.com']; async function h(url) { if (!HOSTS.includes(new URL(url).hostname)) return; ${body} }`;

ruleTester.run('no-user-controlled-fetch-url (value flow)', noUserControlledFetchUrlRule, {
  valid: moved(
    ['via-helper', 'via-object', 'via-array', 'promise-await', 'promise-then', 'callback'],
    'url',
    (e) => `await fetch(${e});`,
    fetchGuarded,
  ).map((code) => ({ code, filename: TS })),
  invalid: [
    // A default import of axios bound to another name.
    {
      code: "const client = require('axios'); async function h(ctx) { await client.post(ctx.request.body.endpoint, {}); }",
      filename: TS,
      errors: [{ messageId: 'userControlledFetchUrl' }],
    },
    // The default export of node-fetch bound to another name.
    {
      code: "import load from 'node-fetch'; async function h(ctx) { await load(ctx.query.src); }",
      filename: TS,
      errors: [{ messageId: 'userControlledFetchUrl' }],
    },
    // A namespace import of node:https bound to another name.
    {
      code: "import * as web from 'node:https'; function h(req) { web.get(req.query.url); }",
      filename: TS,
      errors: [{ messageId: 'userControlledFetchUrl' }],
    },
    // A spread of an array literal is the argument itself.
    {
      code: "const axios = require('axios'); async function h(ctx) { await axios.post(...[ctx.request.body.endpoint], {}); }",
      filename: TS,
      errors: [{ messageId: 'userControlledFetchUrl' }],
    },
  ],
});

const pathGuarded = (body: string): string =>
  `import fs from 'node:fs'; import path from 'node:path'; const ROOT = '/srv/files'; const ALLOWED = ['a.txt', 'b.txt']; function h(req) { const name = req.query.name; if (!ALLOWED.includes(name)) return; ${body} }`;

ruleTester.run('require-path-containment (value flow)', requirePathContainmentRule, {
  valid: moved(
    ['via-helper', 'via-object', 'via-array'],
    'name',
    (e) => `fs.readFileSync(path.join(ROOT, ${e}));`,
    pathGuarded,
  ).map((code) => ({ code, filename: TS })),
  invalid: [
    // The request is found by its place in a route handler, not by its name.
    {
      code: "import fs from 'node:fs'; import path from 'node:path'; app.get('/file', (param1, param2) => { fs.readFileSync(path.join('/srv/files', param1.query.name)); });",
      filename: TS,
      errors: 1,
    },
    // A callback run where it is passed is part of the handler.
    {
      code: "import fs from 'node:fs'; import path from 'node:path'; function h(req) { [req.query.name].forEach((name) => { fs.readFileSync(path.join('/srv/files', name)); }); }",
      filename: TS,
      errors: 1,
    },
  ],
});

ruleTester.run('auth-cookie-flags (value flow)', authCookieFlagsRule, {
  valid: [
    // The flags come in through a spread of an object literal, or of a `const` holding one.
    {
      code: "res.cookie('session', sid, { ...{ httpOnly: true, secure: true, sameSite: 'lax' }, maxAge: 1 });",
      filename: TS,
    },
    {
      code: "const BASE = { httpOnly: true, secure: true, sameSite: 'lax' }; res.cookie('session', sid, { ...BASE, maxAge: 1 });",
      filename: TS,
    },
  ],
  invalid: [
    // A spread of an array literal is the argument itself.
    {
      code: "res.cookie('session', ...[sid], { maxAge: 1 });",
      filename: TS,
      errors: ['httpOnly', 'secure', 'sameSite'].map((flag) => ({
        messageId: 'missingFlag' as const,
        data: { cookie: 'session', flag },
      })),
    },
  ],
});

const htmlEncoded = (body: string): string =>
  `import he from 'he'; async function h(req, res) { const name = he.encode(String(req.query.name)); ${body} }`;

ruleTester.run('no-unescaped-html-response (value flow)', noUnescapedHtmlResponseRule, {
  valid: [
    ...moved(
      ['via-object', 'via-destructuring', 'via-array', 'promise-await', 'promise-then', 'callback'],
      'name',
      (e) => `res.send(\`<p>\${${e}}</p>\`);`,
      htmlEncoded,
    ),
    // An encoder whose argument is spread from an array literal.
    "import he from 'he'; function h(req, res) { res.send(`<p>${he.encode(...[String(req.query.name)])}</p>`); }",
  ].map((code) => ({ code, filename: TS })),
  invalid: [],
});

ruleTester.run('require-sanitized-html (value flow)', requireSanitizedHtmlRule, {
  valid: [
    // The default import of DOMPurify bound to another name.
    {
      code: "import purify from 'dompurify'; const C = ({ x }) => <div dangerouslySetInnerHTML={{ __html: purify.sanitize(x) }} />;",
      filename: TSX,
    },
    // `'<b>'.concat(...)` builds the markup like `+`.
    {
      code: "import DOMPurify from 'dompurify'; function show(el, x) { el.innerHTML = '<b>'.concat(DOMPurify.sanitize(x), '</b>'); }",
      filename: TS,
    },
  ],
  invalid: [
    // The markup object is written once, inside a callback run in place, and
    // the report lands on that object, where the unsanitized value goes in.
    {
      code: [
        'function Page({ bio }) {',
        '  let body; [bio].forEach((relay) => { body = { __html: relay }; });',
        '  return <div dangerouslySetInnerHTML={body} />;',
        '}',
      ].join('\n'),
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml', line: 2 }],
    },
  ],
});

// A container is followed only while nothing can change it: a write at any
// depth, a destructuring write, an alias or a call handed the container ends
// the walk, and the rule judges the value as it did before.

const missingAll = ['httpOnly', 'secure', 'sameSite'].map((flag) => ({
  messageId: 'missingFlag' as const,
  data: { cookie: 'session', flag },
}));
const FLAGS = "{ secure: true, httpOnly: true, sameSite: 'lax' }";
const cookieAfter = (setup: string, spread: string): string =>
  `const C = ${FLAGS}; ${setup} function h(req, res) { res.cookie('session', req.body.t, { ...${spread} }); }`;
const nestedCookieAfter = (change: string): string =>
  `const C = { opts: ${FLAGS} }; function h(req, res) { ${change} res.cookie('session', req.body.t, { ...C.opts }); }`;

ruleTester.run('auth-cookie-flags (changed containers)', authCookieFlagsRule, {
  valid: [],
  invalid: [
    cookieAfter('C.httpOnly = false; C.secure = false; C.sameSite = undefined;', 'C'),
    cookieAfter('Object.assign(C, { httpOnly: false });', 'C'),
    cookieAfter('const D = C; D.httpOnly = false;', 'C'),
    cookieAfter('function f(req) { ({ httpOnly: C.httpOnly } = req.body); }', 'C'),
    nestedCookieAfter('C.opts.secure = false; C.opts.httpOnly = false;'),
    nestedCookieAfter('Object.assign(C.opts, { httpOnly: false });'),
    // A getter run by the spread itself turns a flag off before it is copied.
    "function h(req, res) { res.cookie('session', req.body.t, { ...{ get a() { this.httpOnly = false; return 1; }, secure: true, httpOnly: true, sameSite: 'lax' } }); }",
  ].map((code) => ({ code, filename: TS, errors: missingAll })),
});

ruleTester.run('no-shell-interpolation (changed containers)', noShellInterpolationRule, {
  valid: [],
  invalid: [
    "import { exec } from 'node:child_process'; const cfg = { cmd: 'ls' }; function h(req) { ({ cmd: cfg.cmd } = req.query); exec(`run ${cfg.cmd}`); }",
    "import { exec } from 'node:child_process'; const cfg = { cmd: 'ls' }; function h(req) { [cfg.cmd = 'x'] = [req.query.c]; exec(`run ${cfg.cmd}`); }",
    // Of two parameters with one name the last wins, so `pick` returns the request value.
    "import { exec } from 'node:child_process'; function h(req) { exec('run ' + pick('ls', req.query.c)); } function pick(v, v) { return v; }",
  ].map((code) => ({ code, filename: 'runner.js', errors: [{ messageId: 'shellInterpolation' as const }] })),
});

ruleTester.run('no-user-controlled-fetch-url (changed containers)', noUserControlledFetchUrlRule, {
  valid: [],
  invalid: [
    {
      code: "const links = { to: 'https://api.example.com/x' }; async function h(req) { ({ to: links.to } = req.query); await fetch(links.to); }",
      filename: TS,
      errors: [{ messageId: 'userControlledFetchUrl' }],
    },
  ],
});

ruleTester.run('require-sanitized-html (changed containers)', requireSanitizedHtmlRule, {
  valid: [],
  invalid: [
    {
      code: "const cfg = { html: '<b>hi</b>' }; function h(el, q) { ({ html: cfg.html } = q); el.innerHTML = cfg.html; }",
      filename: TS,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
    {
      code: "const cfg = { m: { __html: '<b>hi</b>' } }; function H(p) { cfg.m.__html = p.x; return <div dangerouslySetInnerHTML={cfg.m} />; }",
      filename: TSX,
      errors: [{ messageId: 'unsanitizedHtml' }],
    },
  ],
});

// A proof walk trusts a container only from an allow-list: a `const` literal
// that is not exported, holds plain data, and is only read by fixed keys in
// read-only places; a `let` written once only when that write surely runs
// first; a callback value only for a one-parameter callback. Each case below
// changes the value in a way the walk cannot see as exact, so the rule must
// report it as it did before the walk existed.

ruleTester.run('auth-cookie-flags (proofs need exact containers)', authCookieFlagsRule, {
  valid: [],
  invalid: [
  // C01 method on nested returned by fn
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } }; function get() { return C.o; }\nexport function h(req: any, res: any) { get().secure = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // C02 for-in computed write
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { for (const k in C) (C as any)[k] = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C03 computed key write
  { code: "const C: any = { secure: true, httpOnly: true, sameSite: 'lax' }; const key = 'secure';\nexport function h(req: any, res: any) { C[key] = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C04 Reflect.set
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { Reflect.set(C, 'secure', false); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C05 defineProperty
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { Object.defineProperty(C, 'httpOnly', { value: false }); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C06 closure write called later
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const off = () => { C.httpOnly = false; };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); off(); }", filename: "probe.ts" },
  // C07 module var hand-off
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; let G: any; G = C; function weaken() { G.httpOnly = false; }\nexport function h(req: any, res: any) { weaken(); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C08 getter secure
  { code: "let flag = false; const C = { get secure() { return flag; }, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C09 getter mutates this during spread
  { code: "const C = { get a() { (this as any).httpOnly = false; return 1; }, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C10 spread of mutated into const
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; C.httpOnly = false; const D = { ...C };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...D }); }", filename: "probe.ts" },
  // C11 const D spread then D mutated
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = { ...C };\nexport function h(req: any, res: any) { D.httpOnly = false; res.cookie('session', req.body.t, { ...D }); }", filename: "probe.ts" },
  // C12 TS-as leaf write
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { (C.httpOnly as any) = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C13 non-null leaf write
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { C.httpOnly! = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C14 angle assertion leaf write
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { (<any>C.httpOnly) = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C15 delete via optional chain
  { code: "const C: any = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { delete C?.httpOnly; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C16 pattern target via TS-as
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { [(C.httpOnly as any)] = [false]; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C17 tagged template method mutates this
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax', off: function (this: any) { this.httpOnly = false; } };\nexport function h(req: any, res: any) { C.off``; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C18 TS-as callee method mutates this
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax', off: function (this: any) { this.httpOnly = false; } };\nexport function h(req: any, res: any) { (C.off as any)(); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C19 non-null callee method
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax', off: function (this: any) { this.httpOnly = false; } };\nexport function h(req: any, res: any) { C.off!(); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C20 exported const (cross-module mutation possible)
  { code: "export const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C21 forEach arr alias mutates
  { code: "export function h(req: any, res: any) { [{ secure: true, httpOnly: true, sameSite: 'lax' }].forEach((o, i, arr) => { arr[0].httpOnly = false; res.cookie('session', req.body.t, { ...o }); }); }", filename: "probe.ts" },
  // C22 let read once, literal aliased via chain assign
  { code: "let o: any; let a: any;\nexport function h(req: any, res: any) { o = a = { secure: true, httpOnly: true, sameSite: 'lax' }; a.httpOnly = false; res.cookie('session', req.body.t, { ...o }); }", filename: "probe.ts" },
  // C23 let single write in loop
  { code: "let o: any;\nexport function h(req: any, res: any) { for (const x of [1]) { o = { secure: true, httpOnly: true, sameSite: 'lax' }; } res.cookie('session', req.body.t, { ...o }); }", filename: "probe.ts" },
  // C24 let single write in try, mutated in catch via other
  { code: "let o: any;\nexport function h(req: any, res: any) { try { o = { secure: true, httpOnly: true, sameSite: 'lax' }; } catch { } res.cookie('session', req.body.t, { ...o }); }", filename: "probe.ts" },
  // C25 Object.setPrototypeOf / assign nested
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { Object.assign(C.o, { httpOnly: false }); res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // C26 JSX spread alias
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { const t = (<X {...C} />); res.cookie('session', req.body.t, { ...C }); }", filename: "x.tsx" },
  // C27 promise then value mutated by sibling
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { Promise.resolve(C).then((o) => { res.cookie('session', req.body.t, { ...o }); }); C.httpOnly = false; }", filename: "probe.ts" },
  // C28 satisfies leaf write
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { (C.httpOnly satisfies boolean as any) = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // C29 update via as
  { code: "const C: any = { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 1 };\nexport function h(req: any, res: any) { (C.maxAge as any)++; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // U01 let assigned only in if, undefined otherwise
  { code: "export function h(req: any, res: any) { let o: any; if (process.env.NODE_ENV === 'production') o = { secure: true, httpOnly: true, sameSite: 'lax' }; res.cookie('session', req.body.t, { ...o }); }", filename: "probe.ts" },
  // U02 let assigned in loop over request list
  { code: "export function h(req: any, res: any) { let o: any; for (const _ of req.body.items) o = { secure: true, httpOnly: true, sameSite: 'lax' }; res.cookie('session', req.body.t, { ...o }); }", filename: "probe.ts" },
  // U03 let undefined options direct
  { code: "export function h(req: any, res: any) { let o: any; if (req.secure) o = { secure: true, httpOnly: true, sameSite: 'lax' }; res.cookie('session', req.body.t, o); }", filename: "probe.ts" },
  // U04 inline spread of undefined (baseline)
  { code: "export function h(req: any, res: any) { res.cookie('session', req.body.t, { ...undefined }); }", filename: "probe.ts" },
  // X01 exported cookie defaults, realistic dev toggle elsewhere
  { code: "export const cookieDefaults = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...cookieDefaults, maxAge: 1000 }); }", filename: "probe.ts" },
  // X02 export list after decl
  { code: "const cookieDefaults = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport { cookieDefaults };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...cookieDefaults }); }", filename: "probe.ts" },
  // X03 export default
  { code: "const cookieDefaults = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport default cookieDefaults;\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...cookieDefaults }); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: missingAll })),
});

ruleTester.run('no-shell-interpolation (proofs need exact containers)', noShellInterpolationRule, {
  valid: [],
  invalid: [
  // S01 TS-as leaf write taint
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' };\nexport function h(req: any) { (cfg.cmd as any) = req.query.c; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S02 non-null leaf write taint
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' };\nexport function h(req: any) { cfg.cmd! = req.query.c; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S03 array push
  { code: "import { exec } from 'child_process';\nconst args = ['ls'];\nexport function h(req: any) { args.push(req.query.c); exec(`run ${args[0]}`); }", filename: "probe.ts" },
  // S04 array splice
  { code: "import { exec } from 'child_process';\nconst args = ['ls'];\nexport function h(req: any) { args.splice(0, 1, req.query.c); exec(`run ${args[0]}`); }", filename: "probe.ts" },
  // S05 array sort
  { code: "import { exec } from 'child_process';\nconst args: any[] = ['ls', 'x'];\nexport function h(req: any) { args[1] = req.query.c; args.sort(); exec(`run ${args[0]}`); }", filename: "probe.ts" },
  // S06 array fill
  { code: "import { exec } from 'child_process';\nconst args = ['ls'];\nexport function h(req: any) { args.fill(req.query.c); exec(`run ${args[0]}`); }", filename: "probe.ts" },
  // S07 array copyWithin via prototype call
  { code: "import { exec } from 'child_process';\nconst args: any[] = ['ls', 'x'];\nexport function h(req: any) { Array.prototype.fill.call(args, req.query.c); exec(`run ${args[0]}`); }", filename: "probe.ts" },
  // S08 computed write
  { code: "import { exec } from 'child_process';\nconst cfg: any = { cmd: 'ls' }; const k = 'cmd';\nexport function h(req: any) { cfg[k] = req.query.c; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S09 Reflect.set
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' };\nexport function h(req: any) { Reflect.set(cfg, 'cmd', req.query.c); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S10 defineProperty
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' };\nexport function h(req: any) { Object.defineProperty(cfg, 'cmd', { value: req.query.c }); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S11 for-in write
  { code: "import { exec } from 'child_process';\nconst cfg: any = { cmd: 'ls' };\nexport function h(req: any) { for (const k in cfg) cfg[k] = req.query.c; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S12 closure write called later
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' }; let set: any;\nexport function h(req: any) { set = (v: any) => { cfg.cmd = v; }; set(req.query.c); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S13 module var hand-off
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' }; const G: any[] = []; G.push(cfg); function poison(v: any) { G[0].cmd = v; }\nexport function h(req: any) { poison(req.query.c); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S14 tagged template method this
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls', set: function (this: any, _s: any, v: any) { this.cmd = v; } };\nexport function h(req: any) { cfg.set`${req.query.c}`; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S15 TS-as callee method this
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls', set: function (this: any, v: any) { this.cmd = v; } };\nexport function h(req: any) { (cfg.set as any)(req.query.c); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S16 let single write in loop
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { let c: any; for (const x of req.query.list) { c = x; } exec(`run ${c}`); }", filename: "probe.ts" },
  // S17 let single write in try
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { let c: any; try { c = 'ls'; } catch (e) { } exec(`run ${c}`); }", filename: "probe.ts" },
  // S18 let write in catch from error
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { let c: any; try { JSON.parse(req.query.j); } catch (e: any) { c = e.message; } exec(`run ${c}`); }", filename: "probe.ts" },
  // S19 let single write, loop reads prior
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { let c: any; for (const x of req.query.list) { exec(`run ${c}`); c = 'ls'; } }", filename: "probe.ts" },
  // S20 exported cfg
  { code: "import { exec } from 'child_process';\nexport const cfg = { cmd: 'ls' };\nexport function h(req: any) { exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S21 forEach arr alias
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { [{ cmd: 'ls' }].forEach((o, i, arr) => { arr[0].cmd = req.query.c; exec(`run ${o.cmd}`); }); }", filename: "probe.ts" },
  // S22 delete optional
  { code: "import { exec } from 'child_process';\nconst cfg: any = { cmd: 'ls' };\nexport function h(req: any) { delete cfg?.cmd; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // S23 nested literal via helper return
  { code: "import { exec } from 'child_process';\nconst cfg = { o: { cmd: 'ls' } }; const pick = () => cfg.o;\nexport function h(req: any) { pick().cmd = req.query.c; exec(`run ${cfg.o.cmd}`); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'shellInterpolation' as const }] })),
});

ruleTester.run('require-path-containment (proofs need exact containers)', requirePathContainmentRule, {
  valid: [],
  invalid: [
  // P02 path control mutated
  { code: "import fs from 'fs';\nconst cfg = { p: 'static.txt' };\nexport function h(req: any) { cfg.p = req.query.p; fs.readFileSync(cfg.p); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'unguardedFsPath' as const }] })),
});

ruleTester.run('no-user-controlled-redirect (proofs need exact containers)', noUserControlledRedirectRule, {
  valid: [],
  invalid: [
  // R02 redirect control
  { code: "const links = { to: '/home' };\nexport function h(req: any, res: any) { links.to = req.query.to; res.redirect(links.to); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'userControlledRedirect' as const }] })),
});

ruleTester.run('no-user-controlled-fetch-url (proofs need exact containers)', noUserControlledFetchUrlRule, {
  valid: [],
  invalid: [
  // F01 fetch TS-as write
  { code: "const links = { to: 'https://api.example.com/x' };\nexport async function h(req: any) { (links.to as any) = req.query.u; await fetch(links.to); }", filename: "probe.ts" },
  // F02 fetch control
  { code: "const links = { to: 'https://api.example.com/x' };\nexport async function h(req: any) { links.to = req.query.u; await fetch(links.to); }", filename: "probe.ts" },
  // F03 fetch array push
  { code: "const urls = ['https://api.example.com/x'];\nexport async function h(req: any) { urls.unshift(req.query.u); await fetch(urls[0]); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'userControlledFetchUrl' as const }] })),
});

ruleTester.run('require-sanitized-html (proofs need exact containers)', requireSanitizedHtmlRule, {
  valid: [],
  invalid: [
  // H01 html TS-as write
  { code: "const cfg = { html: '<b>hi</b>' };\nexport function h(el: any, q: any) { (cfg.html as any) = q.x; el.innerHTML = cfg.html; }", filename: "probe.ts" },
  // H02 html control
  { code: "const cfg = { html: '<b>hi</b>' };\nexport function h(el: any, q: any) { cfg.html = q.x; el.innerHTML = cfg.html; }", filename: "probe.ts" },
  // H03 html array guard push
  { code: "const parts = ['<b>hi</b>'];\nexport function h(el: any, q: any) { parts.splice(0, 1, q.x); el.innerHTML = parts[0]; }", filename: "probe.ts" },
  // H04 html let single write then markup obj
  { code: "let m: any;\nexport function H(p: any) { m = { __html: '<b/>' }; const n = m; n.__html = p.x; return <div dangerouslySetInnerHTML={m} />; }", filename: "x.tsx" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'unsanitizedHtml' as const }] })),
});

// A container must not reach code that could change it: a template tag, an
// operator that runs `Symbol.hasInstance`, `toString` or `valueOf`, a
// prototype or constructor key, or a function stored in it.

ruleTester.run('auth-cookie-flags (containers kept from user code)', authCookieFlagsRule, {
  valid: [],
  invalid: [
  // K01 tagged template gets C
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; function weaken(s: any, o: any) { o.httpOnly = false; return ''; }\nexport function h(req: any, res: any) { weaken`${C}`; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K01b tagged template nested
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } }; const weaken = (s: any, o: any) => { o.httpOnly = false; };\nexport function h(req: any, res: any) { weaken`x${C.o}`; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K02 instanceof hasInstance
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const W: any = { [Symbol.hasInstance](o: any) { o.httpOnly = false; return false; } };\nexport function h(req: any, res: any) { if (C instanceof W) {} res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K03 toString via identifier, template
  { code: "function weaken(this: any) { this.httpOnly = false; return ''; } const C = { toString: weaken, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { console.log(`${C}`); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K03b valueOf via identifier, binary
  { code: "function weaken(this: any) { this.httpOnly = false; return 1; } const C = { valueOf: weaken, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { if (C > 0) {} res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K03c valueOf via identifier, unary +
  { code: "function weaken(this: any) { this.httpOnly = false; return 1; } const C = { valueOf: weaken, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { void +C; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K03d class value via identifier
  { code: "class K { toString() { return ''; } } const C = { k: K, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K04 __proto__ identifier proto toString
  { code: "const P = { toString: function (this: any) { this.httpOnly = false; return ''; } }; const C = { __proto__: P, secure: true, httpOnly: true, sameSite: 'lax' } as any;\nexport function h(req: any, res: any) { console.log(`${C}`); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K04b __proto__ read as primitive then mutated
  { code: "const P: any = {}; const C = { __proto__: P, secure: true, httpOnly: true, sameSite: 'lax' } as any;\nexport function h(req: any, res: any) { Object.defineProperty(C.__proto__, 'x', { value: 1 }); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K04c constructor key read
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' } as any;\nexport function h(req: any, res: any) { const k = C['constructor']; k.assign(C, { httpOnly: false }); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K04d constructor key template
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' } as any;\nexport function h(req: any, res: any) { console.log(`${C['constructor']}`); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K05d nested object via call result entry
  { code: "function mk() { return { secure: true, httpOnly: true, sameSite: 'lax' }; } const C = { o: mk() };\nexport function h(req: any, res: any) { const a = C.o; a.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K06 alias chain exported later
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = C; const E = D; export { E };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06b alias chain exported default
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = C; export default D;\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06c alias mutated deep
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = C; const E = D;\nexport function h(req: any, res: any) { E.httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06d alias module.exports
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = C; module.exports = { D };\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06e alias in tagged template
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const D = C; const w = (s: any, o: any) => { o.httpOnly = false; };\nexport function h(req: any, res: any) { w`${D}`; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06f alias exported via export const
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; export const D = C;\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K06g alias in other fn, returned arrow body
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const get = () => C;\nexport function h(req: any, res: any) { get().httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K08 assignment RHS nested object
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } }; let y: any;\nexport function h(req: any, res: any) { y = C.o; y.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08b logical alias nested object
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { const y: any = C.o || {}; y.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08c conditional alias nested object
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { const y: any = req.x ? C.o : {}; y.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08d array wrap nested object
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { const y: any = [C.o]; y[0].httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08e sequence alias
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { const y: any = (0, C.o); y.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08f paren-as alias
  { code: "const C = { o: { secure: true, httpOnly: true, sameSite: 'lax' } };\nexport function h(req: any, res: any) { const y = C.o as any; y.httpOnly = false; res.cookie('session', req.body.t, { ...C.o }); }", filename: "probe.ts" },
  // K08g satisfies alias then mutate
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { const y = C satisfies object; (y as any).httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K09 class field initializer alias
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; class K { f = C; } \nexport function h(req: any, res: any) { new K().f.httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K09b static block
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' } as any; class K { static { C.httpOnly = false; } }\nexport function h(req: any, res: any) { res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K11b optional callee C.f?.()
  { code: "const C: any = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { C.f?.(); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K11c optional call with C
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; const w: any = (o: any) => { o.httpOnly = false; };\nexport function h(req: any, res: any) { w?.(C); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K12 let single write container then mutate via let
  { code: "let C: any;\nexport function h(req: any, res: any) { C = { secure: true, httpOnly: true, sameSite: 'lax' }; C.httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K12b let single write then mutate via alias
  { code: "let C: any;\nexport function h(req: any, res: any) { C = { secure: true, httpOnly: true, sameSite: 'lax' }; const d = C; d.httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K12c let single write passed to fn
  { code: "let C: any; function w(o: any) { o.httpOnly = false; }\nexport function h(req: any, res: any) { C = { secure: true, httpOnly: true, sameSite: 'lax' }; w(C); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K13 await container
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { void (async () => { await C; })(); res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K13b yield container
  { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' }; function* g() { yield C; }\nexport function h(req: any, res: any) { for (const o of g()) (o as any).httpOnly = false; res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  // K13e loose eq with weird toString identifier
  { code: "const f = function (this: any) { this.httpOnly = false; return 'a'; }; const C = { toString: f, secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { if (C == 'a' as any) {} res.cookie('session', req.body.t, { ...C }); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: missingAll })),
});

ruleTester.run('no-shell-interpolation (containers kept from user code)', noShellInterpolationRule, {
  valid: [],
  invalid: [
  // K01s tagged template gets cfg
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' }; let R: any; function grab(s: any, o: any) { R = o; return ''; }\nexport function h(req: any) { grab`${cfg}`; R.cmd = req.query.c; exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // K02s instanceof hasInstance shell
  { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' }; let W: any;\nexport function h(req: any) { W = { [Symbol.hasInstance](o: any) { o.cmd = req.query.c; return false; } }; void (cfg instanceof W); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // K03s toString identifier shell
  { code: "import { exec } from 'child_process';\nlet IN: any; function swap(this: any) { this.cmd = IN; return ''; } const cfg = { toString: swap, cmd: 'ls' };\nexport function h(req: any) { IN = req.query.c; console.log(`${cfg}`); exec(`run ${cfg.cmd}`); }", filename: "probe.ts" },
  // K07 array numeric alias mutate
  { code: "import { exec } from 'child_process';\nconst A = ['ls']; const B = A;\nexport function h(req: any) { B[0] = req.query.c; exec(`run ${A[0]}`); }", filename: "probe.ts" },
  // K07b array index as string key
  { code: "import { exec } from 'child_process';\nconst A = ['ls'];\nexport function h(req: any) { (A as any)['0'] = req.query.c; exec(`run ${A[0]}`); }", filename: "probe.ts" },
  // K07c array length shrink
  { code: "import { exec } from 'child_process';\nconst A = ['ls'];\nexport function h(req: any) { A.length = 0; exec(`run ${A[0]}`); }", filename: "probe.ts" },
  // K10c cb with default param
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { ['ls'].forEach((v = req.query.c) => { exec(`run ${v}`); }); }", filename: "probe.ts" },
  // K10d cb with rest param
  { code: "import { exec } from 'child_process';\n\nexport function h(req: any) { (['ls'] as any).map((...v: any[]) => { exec(`run ${v}`); }); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'shellInterpolation' as const }] })),
});

ruleTester.run('no-user-controlled-fetch-url (containers kept from user code)', noUserControlledFetchUrlRule, {
  valid: [],
  invalid: [
  // K05 URL entry aliased and mutated
  { code: "export async function h(req: any) { const u = new URL(req.query.u); if (u.host !== 'api.example.com') return; const box = { a: u }; const v = box.a; v.host = req.query.h; await fetch(box.a); }", filename: "probe.ts" },
  // K05b URL entry Object.assign
  { code: "export async function h(req: any) { const u = new URL(req.query.u); if (u.host !== 'api.example.com') return; const box = { a: u }; Object.assign(box.a, { host: req.query.h }); await fetch(box.a); }", filename: "probe.ts" },
  // K05c URL array entry mutated by fn
  { code: "function m(x: any, h: any) { x.host = h; } export async function h(req: any) { const u = new URL(req.query.u); if (u.host !== 'api.example.com') return; const box = [u]; m(box[0], req.query.h); await fetch(box[0]); }", filename: "probe.ts" },
  // K05m main baseline: URL direct alias mutate
  { code: "export async function h(req: any) { const u = new URL(req.query.u); if (u.host !== 'api.example.com') return; const v = u; v.host = req.query.h; await fetch(u); }", filename: "probe.ts" },
  // T04 fetch via tagged mutation
  { code: "const L = { to: 'https://api.example.com/x' };\nexport async function h(req: any) { const t = (s: any, o: any) => { o.to = req.query.u; return ''; }; t`${L}`; await fetch(L.to); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'userControlledFetchUrl' as const }] })),
});

ruleTester.run('no-user-controlled-redirect (containers kept from user code)', noUserControlledRedirectRule, {
  valid: [],
  invalid: [
  // T03 redirect via tagged mutation
  { code: "const T = { to: '/home' };\nexport function h(req: any, res: any) { const t = (s: any, o: any) => { o.to = req.query.next; return ''; }; t`${T}`; res.redirect(T.to); }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'userControlledRedirect' as const }] })),
});

ruleTester.run('require-sanitized-html (containers kept from user code)', requireSanitizedHtmlRule, {
  valid: [],
  invalid: [
  // T05 html via tagged mutation
  { code: "const M = { h: '<b>hi</b>' };\nexport function f(el: any, q: any) { const t = (s: any, o: any) => { o.h = q.x; return ''; }; t`${M}`; el.innerHTML = M.h; }", filename: "probe.ts" },
  ].map((entry) => ({ ...entry, errors: [{ messageId: 'unsanitizedHtml' as const }] })),
});

// A value taken from a binding that changes later (`const box = [u]; u = other`)
// is judged where it was taken, and an `eval` in reach of a binding ends
// any proof that relies on it.

ruleTester.run('auth-cookie-flags (values taken before a change)', authCookieFlagsRule, {
  valid: [],
  invalid: [
    // L11f eval writes C
    { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nexport function h(req: any, res: any) { eval('C.httpOnly = false'); res.cookie('session', req.body.t, { ...C }); }", filename: TS, errors: [{ messageId: 'missingFlag' }, { messageId: 'missingFlag' }, { messageId: 'missingFlag' }] },
    // P08 cookie let flags single box, reassigned
    { code: "export function h(req: any, res: any) { let f: any = { secure: false }; const box = [f]; f = { secure: true, httpOnly: true, sameSite: 'lax' }; res.cookie('session', req.body.t, { ...box[0] }); }", filename: TS, errors: [{ messageId: 'missingFlag' }, { messageId: 'missingFlag' }, { messageId: 'missingFlag' }] },
    // P11 cookie eval in nested fn
    { code: "const C = { secure: true, httpOnly: true, sameSite: 'lax' };\nfunction later() { eval('C.httpOnly = false'); }\nexport function h(req: any, res: any) { later(); res.cookie('session', req.body.t, { ...C }); }", filename: TS, errors: [{ messageId: 'missingFlag' }, { messageId: 'missingFlag' }, { messageId: 'missingFlag' }] },
  ],
});

ruleTester.run('no-user-controlled-fetch-url (values taken before a change)', noUserControlledFetchUrlRule, {
  valid: [
    // N01g a check on the binding itself, after its last write
    { code: "export async function h(req: any) { let u = new URL(req.query.u); u = new URL(req.query.v); if (u.host !== 'api.example.com') return; await fetch(u); }", filename: TS },
  ],
  invalid: [
    // N01 fetch let URL, box array, reassign+pin
    { code: "export async function h(req: any) { let u = new URL(req.query.u); const box = [u]; u = new URL('https://api.example.com'); if (u.host !== 'api.example.com') return; await fetch(box[0]); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01b same with object box
    { code: "export async function h(req: any) { let u = new URL(req.query.u); const box = { a: u }; u = new URL(req.query.v); if (u.host !== 'api.example.com') return; await fetch(box.a); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01c plain const alias then reassign+pin
    { code: "export async function h(req: any) { let u = new URL(req.query.u); const v = u; u = new URL(req.query.v); if (u.host !== 'api.example.com') return; await fetch(v); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01d forward() then reassign+pin
    { code: "const fwd = (x: any) => x;\nexport async function h(req: any) { let u = new URL(req.query.u); const v = fwd(u); u = new URL(req.query.v); if (u.host !== 'api.example.com') return; await fetch(v); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01e callback [u].forEach then reassign inside
    { code: "export async function h(req: any) { let u = new URL(req.query.u); [u].forEach((v) => { u = new URL(req.query.w); if (u.host !== 'api.example.com') return; fetch(v); }); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01h string url box then reassign+startsWith
    { code: "export async function h(req: any) { let u: string = req.query.u; const box = [u]; u = req.query.v; if (!u.startsWith('https://api.example.com/')) return; await fetch(box[0]); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // N01i let single-write box
    { code: "export async function h(req: any) { let u; u = new URL(req.query.u); const box = [u]; if (u.host !== 'api.example.com') return; await fetch(box[0]); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // P10 fetch let single-write eval rewrite
    { code: "export async function h(req: any) { let u; u = 'https://api.example.com/x'; eval('u = req.query.u'); await fetch(u); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
    // Q8 fetch const literal eval
    { code: "const L = { to: 'https://api.example.com/x' };\nexport async function h(req: any) { eval('L.to = req.query.u'); await fetch(L.to); }", filename: TS, errors: [{ messageId: 'userControlledFetchUrl' }] },
  ],
});

ruleTester.run('no-user-controlled-redirect (values taken before a change)', noUserControlledRedirectRule, {
  valid: [
    // N02c a check on a const URL
    { code: "export function h(req: any, res: any) { const u = new URL(req.query.u, 'https://app.example.com'); if (u.origin !== 'https://app.example.com') return; res.redirect(u.href); }", filename: TS },
  ],
  invalid: [
    // N02 redirect let box reassign+guard
    { code: "export function h(req: any, res: any) { let u: string = req.query.u; const box = [u]; u = req.query.v; if (!u.startsWith('/') || u.startsWith('//')) return; res.redirect(box[0]); }", filename: TS, errors: [{ messageId: 'userControlledRedirect' }] },
    // N02b redirect let box reassign+URL pin
    { code: "export function h(req: any, res: any) { let u = new URL(req.query.u, 'https://app.example.com'); const box = [u]; u = new URL(req.query.v, 'https://app.example.com'); if (u.origin !== 'https://app.example.com') return; res.redirect(box[0].href); }", filename: TS, errors: [{ messageId: 'userControlledRedirect' }] },
    // N02e redirect box let reassign url
    { code: "export function h(req: any, res: any) { let u = new URL(req.query.u, 'https://app.example.com'); const box = [u]; u = new URL(req.query.v, 'https://app.example.com'); if (u.origin !== 'https://app.example.com') return; res.redirect(box[0]); }", filename: TS, errors: [{ messageId: 'userControlledRedirect' }] },
    // P01 redirect const alias of let, reassign+guard
    { code: "export function h(req: any, res: any) { let u: string = req.query.u; const v = u; u = req.query.w; if (!u.startsWith('/') || u.startsWith('//')) return; res.redirect(v); }", filename: TS, errors: [{ messageId: 'userControlledRedirect' }] },
    // P03 redirect same-origin path through let box
    { code: "export function h(req: any, res: any) { let u = new URL(req.query.u, 'https://app.example.com'); const box = { p: u.pathname }; u = new URL('/', 'https://app.example.com'); if (u.origin !== 'https://app.example.com' || u.pathname.startsWith('//')) return; res.redirect(box.p); }", filename: TS, errors: [{ messageId: 'userControlledRedirect' }] },
  ],
});

ruleTester.run('require-path-containment (values taken before a change)', requirePathContainmentRule, {
  valid: [],
  invalid: [
    // N03 path let box reassign+guard
    { code: "const fs = require('fs'); const path = require('path');\nfunction h(req: any) { let r = path.resolve('/srv/files', String(req.query.file)); const box = [r]; r = path.resolve('/srv/files', String(req.query.g)); if (!r.startsWith('/srv/files/')) return; fs.writeFileSync(box[0], 'data'); }", filename: TS, errors: [{ messageId: 'unguardedFsPath' }] },
    // P06 path let object box reassign+guard
    { code: "const fs = require('fs'); const path = require('path');\nfunction h(req: any) { let r = path.resolve('/srv/files', String(req.query.file)); const box = { p: r }; r = path.resolve('/srv/files', 'a'); if (!r.startsWith('/srv/files/')) return; fs.writeFileSync(box.p, 'data'); }", filename: TS, errors: [{ messageId: 'unguardedFsPath' }] },
    // Q9 path let box reassign+guard via alias
    { code: "const fs = require('fs'); const path = require('path');\nfunction h(req: any) { let r = path.resolve('/srv/files', String(req.query.file)); const v = r; r = path.resolve('/srv/files', 'a'); if (!r.startsWith('/srv/files/')) return; fs.writeFileSync(v, 'data'); }", filename: TS, errors: [{ messageId: 'unguardedFsPath' }] },
  ],
});

ruleTester.run('no-shell-interpolation (values taken before a change)', noShellInterpolationRule, {
  valid: [],
  invalid: [
    // N04 shell let box reassign+allowlist
    { code: "import { exec } from 'child_process';\nexport function run(x: string, y: string) { let v = x; const box = [v]; v = y; if (v !== 'fast' && v !== 'slow') return; exec(`tool ${box[0]}`); }", filename: TS, errors: [{ messageId: 'shellInterpolation' }] },
    // P04 shell param box reassign+allowlist
    { code: "import { exec } from 'child_process';\nexport function run(x: string, y: string) { const box = [x]; x = y; if (x !== 'fast' && x !== 'slow') return; exec(`tool ${box[0]}`); }", filename: TS, errors: [{ messageId: 'shellInterpolation' }] },
    // P05 shell let fwd reassign+allowlist
    { code: "const fwd = (s: string) => s;\nimport { exec } from 'child_process';\nexport function run(x: string, y: string) { let v = x; const w = fwd(v); v = 'fast'; if (v !== 'fast' && v !== 'slow') return; exec(`tool ${w}`); }", filename: TS, errors: [{ messageId: 'shellInterpolation' }] },
    // Q6 shell const cfg eval
    { code: "import { exec } from 'child_process';\nconst cfg = { cmd: 'ls' };\nexport function h(req: any) { eval('cfg.cmd = req.query.c'); exec(`run ${cfg.cmd}`); }", filename: TS, errors: [{ messageId: 'shellInterpolation' }] },
  ],
});

ruleTester.run('require-sanitized-html (values taken before a change)', requireSanitizedHtmlRule, {
  valid: [
    // Q3 a const that holds the sanitized value
    { code: "import DOMPurify from 'dompurify';\nexport function f(el: any, q: any) { const h = DOMPurify.sanitize(q.x); const box = [h]; el.innerHTML = box[0]; }", filename: TS },
  ],
  invalid: [
    // N05 html let box reassign sanitize
    { code: "import DOMPurify from 'dompurify';\nexport function h(el: any, q: any) { let m = q.x; const holder = [m]; m = DOMPurify.sanitize(q.y); el.innerHTML = holder[0]; }", filename: TS, errors: [{ messageId: 'unsanitizedHtml' }] },
    // Q1 html let box sanitized after
    { code: "import DOMPurify from 'dompurify';\nexport function f(el: any, q: any) { let h = q.x; const box = [h]; h = DOMPurify.sanitize(h); el.innerHTML = box[0]; }", filename: TS, errors: [{ messageId: 'unsanitizedHtml' }] },
    // Q2 html let alias sanitized after
    { code: "import DOMPurify from 'dompurify';\nexport function f(el: any, q: any) { let h = q.x; const v = h; h = DOMPurify.sanitize(h); el.innerHTML = v; }", filename: TS, errors: [{ messageId: 'unsanitizedHtml' }] },
    // Q4 html single write eval
    { code: "import DOMPurify from 'dompurify';\nexport function f(el: any, q: any) { let h; h = '<b>hi</b>'; eval('h = q.x'); el.innerHTML = h; }", filename: TS, errors: [{ messageId: 'unsanitizedHtml' }] },
    // Q5 html const literal box eval
    { code: "import DOMPurify from 'dompurify';\nconst M = { h: '<b>hi</b>' };\nexport function f(el: any, q: any) { eval('M.h = q.x'); el.innerHTML = M.h; }", filename: TS, errors: [{ messageId: 'unsanitizedHtml' }] },
  ],
});

ruleTester.run('no-unescaped-html-response (values taken before a change)', noUnescapedHtmlResponseRule, {
  valid: [],
  invalid: [
    // P07 html let box reassign escape
    { code: "export function h(req: any, res: any) { let v: string = req.query.v; const box = [v]; v = 'x'; if (!/^[a-z]+$/.test(v)) return; res.send('<p>' + box[0] + '</p>'); }", filename: TS, errors: [{ messageId: 'unescapedHtmlResponse' }] },
  ],
});
