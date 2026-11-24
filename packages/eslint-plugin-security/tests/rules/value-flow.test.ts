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
