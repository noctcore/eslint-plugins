import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnescapedHtmlResponseRule } from '../../src/rules/no-unescaped-html-response';

const TS = 'handler.ts';
const TSX = 'page.tsx';
const html = [{ messageId: 'unescapedHtmlResponse' as const }];
const where = [{ messageId: 'unsafeContext' as const }];
const raw = [{ messageId: 'rawTemplateValue' as const }];

const PURIFY = "import DOMPurify from 'isomorphic-dompurify';";
const SANITIZE = "import sanitizeHtml from 'sanitize-html';";
const NUNJUCKS = "import nunjucks from 'nunjucks';";
const CHAIN =
  ".replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')";

ruleTester.run('no-unescaped-html-response', noUnescapedHtmlResponseRule, {
  valid: [
    // Not HTML, or not a response body.
    { code: 'res.json({ name });', filename: TS },
    { code: 'res.send(data);', filename: TS },
    { code: "res.send('Hello ' + name);", filename: TS },
    { code: 'res.send(`count: ${count}`);', filename: TS },
    { code: "logger.send('<p>' + name + '</p>');", filename: TS },
    { code: "res.send('<p>Hello</p>');", filename: TS },
    { code: "const FOOTER = '<footer>v1</footer>'; res.send(`<main>ok</main>${FOOTER}`);", filename: TS },
    // Escaped, sanitized or numeric parts.
    { code: "res.send('<p>' + escapeHtml(name) + '</p>');", filename: TS },
    { code: "import he from 'he'; res.status(200).send(`<p>${he.encode(name)}</p>`);", filename: TS },
    {
      code: `${PURIFY} const clean = DOMPurify.sanitize(comment); const shown = clean; res.send('<div>' + shown + '</div>');`,
      filename: TS,
    },
    {
      code: `${PURIFY} res.end('<section>' + DOMPurify.sanitize(marked.parse(body)) + '</section>');`,
      filename: TS,
    },
    { code: `const safe = input${CHAIN}; res.send(\`<p>\${safe}</p>\`);`, filename: TS },
    { code: "res.send('<p>' + items.length + ' items, ' + Number(total) + ' total</p>');", filename: TS },
    { code: 'res.send(`<p>${price.toFixed(2)}</p>`);', filename: TS },
    { code: "res.send(`<li class=\"${active ? 'on' : 'off'}\">x</li>`);", filename: TS },
    { code: 'res.send(`<p>Generated ${new Date().toISOString()}</p>`);', filename: TS },
    // Values checked before the response.
    {
      code: "function h(req, res) { const sort = String(req.query.sort); if (!/^(asc|desc)$/.test(sort)) { res.status(400).json({ error: 'sort' }); return; } res.send('<p>' + sort + '</p>'); }",
      filename: TS,
    },
    {
      code: "function h(req, res) { const tag = req.query.tag; if (!/^[a-zA-Z0-9 _.#%-]+$/.test(tag)) return; res.send(`<p>${tag}</p>`); }",
      filename: TS,
    },
    // In element text, `'` and `"` are plain text: a guard only has to refuse `<` and `&`.
    {
      code: "function h(bio, res) { if (!/^[\\w\\s.,'-]{1,200}$/.test(bio)) return; res.end(`<p>${bio}</p>`); }",
      filename: TS,
    },
    // A literal allowlist proves a value even in a script element.
    {
      code: "function h(req, res) { const sort = req.query.sort; if (!['asc', 'desc'].includes(sort)) return; res.send(`<script>var sort = '${sort}';</script>`); }",
      filename: TS,
    },
    // A non-HTML content type set on every path first.
    { code: "function h(res, name) { res.type('text/plain'); res.send('<p>' + name + '</p>'); }", filename: TS },
    {
      code: "function h(res, name) { res.set('Content-Type', 'application/json'); res.end(`{\"html\": \"<p>${name}</p>\"}`); }",
      filename: TS,
    },
    { code: "function h(res, name) { res.type('text').send('<p>' + name + '</p>'); }", filename: TS },
    {
      code: "function h(res, name) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('<p>' + name + '</p>'); }",
      filename: TS,
    },
    // A configured escaper.
    { code: "res.send('<p>' + toHtml(name) + '</p>');", filename: TS, options: [{ sanitizers: ['toHtml'] }] },
    {
      code: "res.send('<p>' + utils.toHtml(name) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['utils.toHtml'] }],
    },
    // Templates: escaped by default, or a raw key bound to a safe value.
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ bio }}</p>', { bio: input });`, filename: TS },
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ user.bio }}</p>', { user: req.user });`, filename: TS },
    {
      code: `${NUNJUCKS} ${PURIFY} nunjucks.renderString('<p>{{ bio | safe }}</p>', { bio: DOMPurify.sanitize(input) });`,
      filename: TS,
    },
    {
      code: `${NUNJUCKS} const shown = input${CHAIN}; nunjucks.renderString('<p>{{ bio | safe }}</p>', { bio: shown });`,
      filename: TS,
    },
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ bio | escape }}</p>', { bio: input });`, filename: TS },
    { code: "ejs.render('<p><%= bio %></p>', { bio: input });", filename: TS },
    { code: `${NUNJUCKS} nunjucks.renderString(template, { bio: input });`, filename: TS },
    {
      code: `${NUNJUCKS} nunjucks.renderString('<p>{{ bio | safe }}</p>', { title: input, bio: '<b>fixed</b>' });`,
      filename: TS,
    },
    {
      code: `${NUNJUCKS} ${PURIFY} nunjucks.renderString('<p>{{ user.bio | safe }}</p>', { user: { bio: DOMPurify.sanitize(input) } });`,
      filename: TS,
    },
    // Escapers imported from their modules under any name.
    { code: "import { encode } from 'he'; res.send('<p>' + encode(comment) + '</p>');", filename: TS },
    { code: "import * as entities from 'he'; res.send(`<p>${entities.encode(comment)}</p>`);", filename: TS },
    { code: "const esc = require('escape-html'); res.send('<p>' + esc(comment) + '</p>');", filename: TS },
    { code: "const { escape: e } = require('lodash'); res.send('<p>' + e(comment) + '</p>');", filename: TS },
    { code: "import _ from 'lodash'; res.send('<p>' + _.escape(comment) + '</p>');", filename: TS },
    { code: "const xss = require('xss'); res.send('<p>' + xss(comment) + '</p>');", filename: TS },
    { code: "import { filterXSS } from 'xss'; res.send('<p>' + filterXSS(comment) + '</p>');", filename: TS },
    {
      code: "import createDOMPurify from 'dompurify'; const purify = createDOMPurify(window); res.send('<p>' + purify.sanitize(comment) + '</p>');",
      filename: TS,
    },
    // React escapes the text it renders.
    {
      code: "import { renderToString } from 'react-dom/server'; res.send('<!doctype html><div id=\"root\">' + renderToString(app) + '</div>');",
      filename: TS,
    },
    // A Unicode letter class with the `u` flag admits no markup.
    {
      code: "function h(req, res) { const bio = String(req.body.bio); if (!/^[\\p{L}\\p{N} .,-]{0,200}$/u.test(bio)) return res.status(400).end(); res.send('<p>' + bio + '</p>'); }",
      filename: TS,
    },
    // `.replace` chains: global, every character consumed, plain text written.
    {
      code: "res.send('<p>' + q.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;') + '</p>');",
      filename: TS,
    },
    { code: "res.send('<p>' + q.replace(/[&<>\"]/g, '') + '</p>');", filename: TS },
    {
      code: "const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }; res.send(`<a title='${q.replace(/[&<>\"']/g, (c) => MAP[c])}'>x</a>`);",
      filename: TS,
    },
    {
      code: "res.send('<p>' + q.replace(/[&<>\"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }) + '</p>');",
      filename: TS,
    },
    { code: "import he from 'he'; res.send('<p>' + he.encode(q).replace(/\\n/g, '<br>') + '</p>');", filename: TS },
    // Escaping that fits where the value lands.
    { code: "res.send(`<a href=\"/users/${escapeHtml(id)}\">profile</a>`);", filename: TS },
    { code: 'res.send(`<a href="${encodeURIComponent(next)}">next</a>`);', filename: TS },
    { code: 'res.send(`<img src=${encodeURIComponent(name)}>`);', filename: TS },
    { code: "import he from 'he'; res.send(`<a title='${he.encode(name)}'>x</a>`);", filename: TS },
    { code: 'res.send(`<div onclick="open(${Number(id)})">x</div>`);', filename: TS },
    { code: 'res.send(`<textarea>${escapeHtml(note)}</textarea>`);', filename: TS },
    { code: 'res.send(`<!-- ${escapeHtml(note)} --><p>x</p>`);', filename: TS },
    {
      code: "import serialize from 'serialize-javascript'; res.send(`<script>window.__STATE__ = ${serialize(state)};</script>`);",
      filename: TS,
    },
    // Division and closed regex literals leave the lexer in code position.
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>const a = b\nconst c = d / 2\nvar s = ${serialize(req.query.q)};</script>`); }", filename: TS, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>function f() { return 1 } // it's\nvar s = ${serialize(req.query.q)};</script>`); }", filename: TS, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>if (a) { b() } /* it's */ var s = ${serialize(req.query.q)};</script>`); }", filename: TS, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var i = 1, n = 2; i\nn / 2; var s = ${serialize(req.query.q)};</script>`); }", filename: TS, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var r = a.b / c; var s = ${serialize(req.query.q)};</script>`); }", filename: TS, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var r = a / ${serialize(req.query.q)};</script>`); }', filename: TS, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var x = a / b / c; var s = ${serialize(req.query.q)};</script>`); }', filename: TS, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>x = /\'/; var s = ${serialize(req.query.q)};</script>`); }', filename: TS, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var m = (a + b) / 2; f(g(1)) / 3; var s = ${serialize(req.query.q)};</script>`); }', filename: TS, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>function f(s) { return /\'/.test(s) } var s = ${serialize(req.query.q)};</script>`); }', filename: TS, },
    // Serialized JSON in code position: after a closed string (escaped quotes included), a comment, or in `${}`.
    {
      code: "import serialize from 'serialize-javascript'; res.send(`<script>var a = 'it\\'s'; /* \"x */ // 'y\nvar s = ${serialize(state)};</script>`);",
      filename: TS,
    },
    {
      code: "import serialize from 'serialize-javascript'; res.send(`<script>var t = \\`x ${'${'}${serialize(state)}}\\`; var u = ${serialize(other)};</script>`);",
      filename: TS,
    },
    {
      code: "import htmlescape from 'htmlescape'; res.send(`<script>var a = ${htmlescape(one)}, b = ${htmlescape(two)};</script>`);",
      filename: TS,
    },
    // A same-file function named like a configured escaper is judged by its body, which here encodes everything.
    { code: "function escapeHtml(s) { return String(s)" + CHAIN + "; } res.send(`<p>${escapeHtml(q)}</p>`);", filename: TS },
    {
      code: "function escapeHtml(s) { return String(s)" + CHAIN + "; } res.send(`<p>${escapeHtml(q)}</p>`);",
      filename: TS,
      options: [{ sanitizers: ['escapeHtml'] }],
    },
    // The name is trusted for an import from a module this file cannot see into.
    { code: "import { escapeHtml } from './util'; res.send(`<p>${escapeHtml(q)}</p>`);", filename: TS },
    { code: "function escapeHtml(s) { return String(s)" + CHAIN + ".replace(/'/g, '&#39;'); } res.send(`<a title='${escapeHtml(t)}'>x</a>`);", filename: TS },
    // Sanitizer options that keep protection on.
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(bio, { allowedTags: ['b', 'i', 'a'], allowedAttributes: { a: ['href'] } }) + '</p>');`,
      filename: TS,
    },
    {
      code: `${SANITIZE} const OPTIONS = { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']) }; res.send('<p>' + sanitizeHtml(bio, OPTIONS) + '</p>');`,
      filename: TS,
    },
    {
      code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(bio, { ALLOWED_TAGS: ['b', 'i'], ALLOWED_ATTR: ['title'] }) + '</p>');`,
      filename: TS,
    },
    // String building followed through accumulators, joins and helpers.
    {
      code: "const ROWS = [['north', 12], ['south', 7]]; function h(res) { let html = '<table>'; for (const [region, total] of ROWS) { html += '<tr><td>' + region + '</td><td>' + total + '</td></tr>'; } html += '</table>'; res.send(html); }",
      filename: TS,
    },
    {
      code: 'function h(res, items) { res.send(`<ul>${items.map((item) => `<li>${escapeHtml(item.name)}</li>`).join(\'\')}</ul>`); }',
      filename: TS,
    },
    {
      code: 'function row(cell) { return `<td>${escapeHtml(cell)}</td>`; } function h(res, name) { res.send(`<tr>${row(name)}</tr>`); }',
      filename: TS,
    },
    { code: 'function h(res, user) { res.send(`<p>${user && escapeHtml(user.name)}</p>`); }', filename: TS },
    {
      code: 'function h(res, items) { res.send(`<ul>${items.map((item) => { const name = escapeHtml(item.name); return `<li>${name}</li>`; }).join(\'\')}</ul>`); }',
      filename: TS,
    },
    { code: 'res.send(`<a href=" JavaScript:void(${Number(id)})">x</a>`);', filename: TS },
    { code: "const STRIP = /[&<>\"]/g; res.send('<p>' + q.replace(STRIP, '') + '</p>');", filename: TS },
    { code: "function h(reply, name) { reply.type('application/json').send(`<p>${name}</p>`); }", filename: TS },
    { code: "function h(ctx, name) { ctx.type = 'text/plain'; ctx.body = '<p>' + name + '</p>'; }", filename: TS },
    // Sinks that send text unless an HTML type is set.
    { code: "function h(reply, name) { reply.send('<p>' + name + '</p>'); }", filename: TS },
    { code: "function h(ctx, name) { ctx.body = 'Hello ' + name + '<br>'; }", filename: TS },
    { code: "export function GET(req) { return new Response(`<p>${req.url}</p>`); }", filename: TS },
    // A global sanitizer config that keeps protection on, or set on another instance.
    {
      code: "import { sanitize, setConfig } from 'isomorphic-dompurify'; setConfig({ ALLOWED_TAGS: ['b'], ADD_URI_SAFE_ATTR: ['title'], ADD_DATA_URI_TAGS: ['img'] }); res.send('<div>' + sanitize(q) + '</div>');",
      filename: TS,
    },
    {
      code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { NAMESPACE: 'http://www.w3.org/1999/xhtml', PARSER_MEDIA_TYPE: 'text/html' }) + '</p>');`,
      filename: TS,
    },
    {
      code: "import createDOMPurify from 'dompurify'; const purify = createDOMPurify(window); const loose = createDOMPurify(window); loose.setConfig({ ADD_TAGS: ['script'] }); res.send('<p>' + purify.sanitize(q) + '</p>');",
      filename: TS,
    },
    // Shared defaults only read, copied or handed to the sanitizer.
    {
      code: `${SANITIZE} const count = sanitizeHtml.defaults.allowedTags.length; res.send('<p>' + count + sanitizeHtml(q, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']) }) + '</p>');`,
      filename: TS,
    },
    {
      code: "const xss = require('xss'); const list = xss.getDefaultWhiteList(); list.img.push('onerror'); res.send('<p>' + xss(q) + '</p>');",
      filename: TS,
    },
    { code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedAttributes: { '*': ['data-*'] }, allowedSchemesByTag: { img: ['data'] } }) + '</p>');`, filename: TS },
    { code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedSchemes: ['data', 'https'] }) + '</p>');`, filename: TS },
    // React rendering with inner HTML that is constant or sanitized.
    {
      code: `import { renderToString } from 'react-dom/server'; ${PURIFY} function Bio({ bio }) { return <p dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bio) }} />; } res.send('<div id="root">' + renderToString(<main><Bio bio={q} /><i dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} /></main>) + '</div>');`,
      filename: TSX,
    },
    { code: "import { renderToString } from 'react-dom/server'; res.send(renderToString(<p>{q}</p>));", filename: TSX },
    { code: "import { renderToString } from 'react-dom/server'; res.send(renderToString(<i dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />));", filename: TSX },
    { code: "import { renderToString } from 'react-dom/server'; res.json({ markup: renderToString(<p dangerouslySetInnerHTML={{ __html: q }} />) });", filename: TSX },
    // EJS options that keep escaping and read a custom delimiter.
    { code: "ejs.render('<p><?= bio ?></p>', { bio: input }, { delimiter: '?' });", filename: TS },
    { code: "ejs.render('<p><%= bio %></p>', { bio: input }, { cache: true, filename: 'bio.ejs', rmWhitespace: true });", filename: TS },
    { code: "ejs.render('<p><?= bio ?></p>', { bio: input, delimiter: '?' });", filename: TS },
    // Constant text, dotted escapers that are imported, and data blocks.
    {
      code: "import serialize from 'serialize-javascript'; const OPEN = 'window.S = '; export function h(req, res) { res.send(`<script>${OPEN}${serialize(req.query.q)}</script>`); }",
      filename: TS,
    },
    {
      code: "import utils from './utils'; res.send('<p>' + utils.escapeHtml(q) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['utils.escapeHtml'] }],
    },
    {
      code: "const utils = require('./utils'); res.send('<p>' + utils.escapeHtml(q) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['utils.escapeHtml'] }],
    },
    {
      code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = 1// n\nb / 2; var s = ${serialize(req.query.q)};</script>`); }",
      filename: TS,
    },
    {
      code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = [...b], c = 1.5 / 2, d = x\u00B7y / 2; var s = ${serialize(req.query.q)};</script>`); }",
      filename: TS,
    },
    {
      code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"application/json\" id=\"state\">${serialize(req.query.q)}</script>`); }",
      filename: TS,
    },
    {
      code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"application/ld+json\">'${serialize(req.query.q)}'</script>`); }",
      filename: TS,
    },
    { code: "export function h(req, res) { res.send(`<script type=\"text/plain\"><p>${escapeHtml(req.query.q)}</p></script>`); }", filename: TS },
    {
      code: "export function h(req, res) { res.send(`<script><!-- a --></script><p>${escapeHtml(req.query.q)}</p>`); }",
      filename: TS,
    },
    // Markup through calls, tags, placeholders and accumulators, escaped.
    { code: "export function h(req, res) { res.send(layout(`<h1>${escapeHtml(req.query.q)}</h1>`)); }", filename: TS },
    { code: "import { safeHtml } from 'common-tags'; export function h(req, res) { res.send(safeHtml`<h1>${req.query.q}</h1>`); }", filename: TS },
    { code: `export function h(req, res) { res.send(\`<a href="${' '.repeat(300)}/s?q=\${encodeURIComponent(req.query.q)}">x</a>\`); }`, filename: TS },
    { code: `export function h(req, res) { res.send(\`<a href="https${'\\t'.repeat(300)}://x.test/\${escapeHtml(req.query.q)}">x</a>\`); }`, filename: TS },    { code: "ejs.render('<p><%= bio %></p>', { ...opts, bio: escapeHtml(input) });", filename: TS },
    { code: "import utils from './utils'; utils.cache = new Map(); res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }] },
    { code: "const utils = require('./utils'); Object.assign(other, utils); res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }] },
    { code: `${PURIFY} DOMPurify.setConfig.apply(null, [{ ALLOWED_TAGS: ['b'] }]); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS },
    // A replacer function's result is written as is, with no `$` patterns.
    { code: "const TPL = '<h1>{{name}}</h1>'; export function h(req, res) { res.send(TPL.replace('{{name}}', () => escapeHtml(req.query.q))); }", filename: TS },
    { code: "const TPL = '<a href=\"/s?q={{q}}\">x</a>'; export function h(req, res) { res.send(TPL.replace('{{q}}', encodeURIComponent(req.query.q))); }", filename: TS },
    {
      code: "const TPL = '<p>{{a}}</p><p>{{b}}</p>'; export function h(req, res) { res.send(TPL.replace('{{a}}', () => escapeHtml(req.query.a)).replace('{{b}}', () => escapeHtml(req.query.b))); }",
      filename: TS,
    },
    // A call from elsewhere given escaped markup and constants, with no author tag around it.
    { code: "export function h(req, res) { res.send(layout(`<main>${escapeHtml(req.query.q)}</main>`, 'Title', 2)); }", filename: TS },
    {
      code: "export function h(res, list) { const rows = []; for (const r of list) rows.push('<li>' + escapeHtml(r.name) + '</li>'); res.send('<ul>' + rows.join('') + '</ul>'); }",
      filename: TS,
    },
    {
      code: "export function h(res, items) { res.send(`<ul>${items.map((i) => { if (i.hidden) return ''; return `<li>${escapeHtml(i.name)}</li>`; }).join('')}</ul>`); }",
      filename: TS,
    },
    // Nest handlers that do not send their return value as HTML.
    {
      code: "import { Controller, Get, Header, Query } from '@nestjs/common'; @Controller() class C { @Get() @Header('Content-Type', 'text/plain') find(@Query('q') q: string) { return `<h1>${q}</h1>`; } }",
      filename: TS,
    },
    {
      code: "import { Controller, Get, Query, Render } from '@nestjs/common'; @Controller() class C { @Get() @Render('page') find(@Query('q') q: string) { return { q }; } }",
      filename: TS,
    },
    {
      code: "import { Controller, Get, Query, Res } from '@nestjs/common'; @Controller() class C { @Get() find(@Query('q') q: string, @Res() res) { res.json({ q }); return `<h1>${q}</h1>`; } }",
      filename: TS,
    },
    {
      code: "import * as common from '@nestjs/common'; @common.Controller() class C { @common.Get() @common.Header('Content-Type', 'application/json') find(@common.Query('q') q = '') { return `<h1>${q}</h1>`; } }",
      filename: TS,
    },
    {
      code: "import * as common from '@nestjs/common'; @common.Controller() class C { @common.Get() find(@common.Query('q') q = '', @common.Res() res = null) { res.json({ q }); return `<h1>${q}</h1>`; } }",
      filename: TS,
    },
    { code: "export function h(req, res) { res.send(layout('<h1>'.concat(escapeHtml(req.query.q), '</h1>'))); }", filename: TS },
    { code: "class C { find(q: string) { return `<h1>${q}</h1>`; } }", filename: TS },
    // URLs, comments and meta content where the value is safe.
    { code: "export function h(req, res) { res.send(`<img src=\"data:image/png;base64,${encodeURIComponent(req.query.b)}\"><iframe src=\"https://x.test/?q=${encodeURIComponent(req.query.q)}\"></iframe>`); }", filename: TS },
    { code: "export function h(req, res) { res.send(`<!-- ${escapeHtml(req.query.q)} --><a href=\"/s?a=1&amp;q=${encodeURIComponent(req.query.q)}\">s</a>`); }", filename: TS },
    { code: "export function h(req, res) { res.send(`<meta name=\"description\" content=\"${escapeHtml(req.query.d)}\"><meta http-equiv=\"refresh\" content=\"5;url=/home?q=${encodeURIComponent(req.query.q)}\">`); }", filename: TS },
    { code: `${NUNJUCKS} nunjucks.renderString('{% set b = bio %}<p>{{ b }}</p>', { bio: input });`, filename: TS },
    // Other frameworks: no HTML type, or no branch that starts with markup.
    { code: "fastify.get('/', async (request, reply) => { return `<h1>${request.query.q}</h1>`; });", filename: TS },
    { code: "function h(ctx, ok) { ctx.body = ok ? 'Done' : 'Failed: ' + ctx.query.q + '<br>'; }", filename: TS },  ],
  invalid: [
    // A same-file function with a configured name is judged by its body, not its name.
    {
      code: "function escapeHtml(str) { return str.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\"', '&quot;'); }\nexport function h(req, res) { res.send('<p>Results for ' + escapeHtml(req.query.q) + '</p>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function escapeHtml(str) { return str.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\"', '&quot;'); }\nexport function h(req, res) { res.send('<p>Results for ' + escapeHtml(req.query.q) + '</p>'); }",
      filename: TS,
      options: [{ sanitizers: ['escapeHtml'] }],
      errors: html,
    },
    {
      code: "const htmlEscape = (s) => String(s).replace(/[&<>\"]/, (c) => '&#' + c.charCodeAt(0) + ';');\nexport function h(req, res) { res.send('<p>' + htmlEscape(req.query.q) + '</p>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function escapeHtml(s) { return String(s); }\nexport function h(req, res) { res.send('<p>' + escapeHtml(req.query.q) + '</p>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function escapeHtml(s) { return String(s); }\nexport function h(req, res) { res.send('<p>' + escapeHtml(req.query.q) + '</p>'); }",
      filename: TS,
      options: [{ sanitizers: ['escapeHtml'] }],
      errors: html,
    },
    {
      code: "const escapeHtml = (s) => s.replace('<', '&lt;');\nexport function h(req, res) { res.send('<p>' + escapeHtml(req.query.q) + '</p>'); }",
      filename: TS,
      errors: html,
    },
    // Whitespace ends a word, a property is never a keyword, and a `/` after `}` or a contextual keyword is unknown.
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>if (a) x = y\nelse /'/.test(s) ? 'n' : '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>function f(c) {\n  const q = c\n  return /'/.test(q) ? '${serialize(req.query.q)}' : ''\n}</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>let m = s\nif (m) /'/.test(m) && f('${serialize(req.query.q)}')</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = {} / '/; var b = ${serialize(req.query.q)}; //'</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = function(){} / '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var r = a.return / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var r = a.with(0, 1) / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var r = a.if(x) / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var of = 4; var r = of / 2; var s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var await = 4; var r = await / 2; var s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var yield = 4; var r = yield / 2; var s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>i\nn / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where, },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>for (const ch of /'/.exec(s)) f('${serialize(req.query.q)}')</script>`); }", filename: TS, errors: where, },
    // A quote inside a regex literal opens no string; a value in a regex body is not code.
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var ok = /^[a-z\']+$/.test(n); var s = \'${serialize(req.query.q)}\';</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var re = /\'/g; var s = \'${serialize(req.query.q)}\';</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var re = /"/g; var s = "${serialize(req.query.q)}";</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var re = /\\`/g; var s = \\`${serialize(req.query.q)}\\`;</script>`); }', filename: TS, errors: where, },
    { code: 'import htmlescape from \'htmlescape\';\nexport function h(req, res) { res.send(`<script>var re = /${htmlescape(req.query.q)}/i;</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var re = /${serialize(req.query.q)}/i;</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>if (a) /\'/.test(s); var s = \'${serialize(req.query.q)}\';</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var x = i++ / 2 + \'/\' + \'${serialize(req.query.q)}\';</script>`); }', filename: TS, errors: where, },
    { code: 'import serialize from \'serialize-javascript\';\nexport function h(req, res) { res.send(`<script>var re = /[/\']/; var s = \'${serialize(req.query.q)}\';</script>`); }', filename: TS, errors: where, },
    // Serialized JSON inside a JS string, template or comment can close it.
    {
      code: "import serialize from 'serialize-javascript';\nres.send(`<script>window.__STATE__ = JSON.parse('${serialize(req.query.q, { isJSON: true })}');</script>`);",
      filename: TS,
      errors: where,
    },
    {
      code: "import serialize from 'serialize-javascript';\nres.send(`<script>var s = \"${serialize(req.query.q)}\";</script>`);",
      filename: TS,
      errors: where,
    },
    {
      code: "import serialize from 'serialize-javascript';\nres.send(`<script>var s = \\`${serialize(req.query.q)}\\`;</script>`);",
      filename: TS,
      errors: where,
    },
    {
      code: "import htmlescape from 'htmlescape'; res.send(`<script>var s = 'a\\\\'b ${htmlescape(q)}';</script>`);",
      filename: TS,
      errors: where,
    },
    {
      code: "import serialize from 'serialize-javascript'; res.send(`<script>// note\n/* ${serialize(q)} */</script>`);",
      filename: TS,
      errors: where,
    },
    { code: "res.send('<div>' + data + '</div>');", filename: TS, errors: html },
    {
      code: "function h(req, res) { const raw = req.cookies.session; const data = raw && raw.length > 0 ? raw : 'default'; res.send('<div>' + data + '</div>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function h(req, res) { const data = decodeURIComponent(req.query.id); res.set('Content-Type', 'text/html; charset=utf-8'); res.end('<section>' + data + '</section>'); }",
      filename: TS,
      errors: html,
    },
    { code: 'res.status(200).send(`<h1>Hello ${name}</h1>`);', filename: TS, errors: html },
    { code: "response.write('<li>' + item.title + '</li>');", filename: TS, errors: html },
    {
      code: "async function h(res) { const row = await db.query('SELECT name FROM users'); const data = `${row.name}`; res.send('<div>' + data + '</div>'); }",
      filename: TS,
      errors: html,
    },
    { code: "const page = '<html><body>' + body + '</body></html>'; res.send(page);", filename: TS, errors: html },
    // The outermost call decides.
    {
      code: `${PURIFY} res.send('<div>' + marked.parse(DOMPurify.sanitize(body)) + '</div>');`,
      filename: TS,
      errors: html,
    },
    // Escape chains that miss a character or only hit the first match.
    { code: "res.send('<p>' + input.replace(/</g, '&lt;') + '</p>');", filename: TS, errors: html },
    {
      code: "res.send('<p>' + q.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\"', '&quot;') + '</p>');",
      filename: TS,
      errors: html,
    },
    { code: "res.send('<p>' + q.replace(/[&<>\"]/, '') + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + q.replace(/[&<>\"]/g, (c) => c) + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + q.replace(/[&<>\"]/gy, '') + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + q.replace(/[&<>\"]/g, '$&') + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + q.replace(/[&<>\"]*/g, '') + '</p>');", filename: TS, errors: html },
    { code: `res.send('<p>' + q${CHAIN}.replace(/&lt;/g, '<') + '</p>');`, filename: TS, errors: html },
    {
      code: "const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }; res.send('<p>' + q.replace(/[&<>\"]/g, (c) => MAP[c] || c) + '</p>');",
      filename: TS,
      errors: html,
    },
    {
      code: "const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }; MAP['<'] = '<'; res.send('<p>' + q.replace(/[&<>\"]/g, (c) => MAP[c]) + '</p>');",
      filename: TS,
      errors: html,
    },
    // Near misses of a guard.
    {
      code: "function h(req, res) { const tag = req.query.tag; if (!/^[\\\\w<>]+$/.test(tag)) return; res.send(`<p>${tag}</p>`); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function h(req, res) { const tag = req.query.tag; if (!/^(a|b)$/.test(tag)) { log(tag); } res.send(`<p>${tag}</p>`); }",
      filename: TS,
      errors: html,
    },
    // A regex guard proves no script element value.
    {
      code: "function h(req, res) { const n = req.query.n; if (!/^[a-z=]+$/.test(n)) return; res.send(`<script>var n = ${n};</script>`); }",
      filename: TS,
      errors: where,
    },
    // An HTML content type does not excuse it, nor a plain type set on one path only.
    { code: "function h(res, name) { res.type('html'); res.send('<p>' + name + '</p>'); }", filename: TS, errors: html },
    {
      code: "function h(res, name, asJson) { if (asJson) res.type('application/json'); res.send('<p>' + name + '</p>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function h(res, name) { res.type('text/plain'); res.type('image/svg+xml'); res.send('<p>' + name + '</p>'); }",
      filename: TS,
      errors: html,
    },
    // Escaping that does not fit where the value lands.
    { code: 'res.send(`<img src=${escapeHtml(name)}>`);', filename: TS, errors: where },
    { code: 'res.send(`<img alt=${escapeHtml(name)}>`);', filename: TS, errors: where },
    { code: 'res.send(`<a href="${escapeHtml(next)}">next</a>`);', filename: TS, errors: where },
    { code: 'res.send(`<a href=" ${escapeHtml(next)}">next</a>`);', filename: TS, errors: where },
    { code: 'res.send(`<script>var n = ${escapeHtml(name)};</script>`);', filename: TS, errors: where },
    { code: 'res.send(`<style>body { color: ${escapeHtml(color)}; }</style>`);', filename: TS, errors: where },
    { code: 'res.send(`<div onclick="go(\'${escapeHtml(id)}\')">x</div>`);', filename: TS, errors: where },
    { code: 'res.send(`<div style="color: ${escapeHtml(color)}">x</div>`);', filename: TS, errors: where },
    { code: 'res.send(`<iframe srcdoc="${escapeHtml(doc)}"></iframe>`);', filename: TS, errors: where },
    { code: "res.send(`<a title='${escapeHtml(name)}'>x</a>`);", filename: TS, errors: where },
    { code: "res.send(`<a href='${encodeURIComponent(next)}'>x</a>`);", filename: TS, errors: where },
    { code: 'res.send(`<${escapeHtml(tag)}>x</p>`);', filename: TS, errors: where },
    { code: 'res.send(`<div ${escapeHtml(attr)}>x</div>`);', filename: TS, errors: where },
    { code: 'res.send(`<script>var data = ${JSON.stringify(data)};</script>`);', filename: TS, errors: html },
    {
      code: `${PURIFY} res.send(\`<a title="\${DOMPurify.sanitize(bio)}">x</a>\`);`,
      filename: TS,
      errors: where,
    },
    // Sanitizer options that switch protection off.
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(bio, { allowedTags: false, allowedAttributes: false }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(bio, { allowedTags: ['script'], allowVulnerableTags: true }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(bio, { allowedAttributes: { img: ['src', 'onerror'] } }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    {
      code: `${SANITIZE} const OPTIONS = { allowedTags: ['b'] }; OPTIONS.allowedTags = false; res.send('<p>' + sanitizeHtml(bio, OPTIONS) + '</p>');`,
      filename: TS,
      errors: html,
    },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(bio, { RETURN_DOM: true }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(bio, { ADD_TAGS: ['script'] }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(bio, { ADD_ATTR: ['onerror'] }) + '</p>');`, filename: TS, errors: html },
    {
      code: `${PURIFY} DOMPurify.setConfig({ ALLOWED_URI_REGEXP: /.*/ }); res.send('<p>' + DOMPurify.sanitize(bio) + '</p>');`,
      filename: TS,
      errors: html,
    },
    {
      code: "const xss = require('xss'); res.send('<p>' + xss(bio, { onIgnoreTag: (tag, html) => html }) + '</p>');",
      filename: TS,
      errors: html,
    },
    {
      code: "import he from 'he'; res.send('<p>' + he.encode(bio, { allowUnsafeSymbols: true }) + '</p>');",
      filename: TS,
      errors: html,
    },
    // Bare names that any method or local function may share.
    { code: "res.send('<p>' + mysql.escape(name) + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + conn.escape(name) + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + mongoSanitize.sanitize(name) + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + xss(name) + '</p>');", filename: TS, errors: html },
    { code: "res.send('<p>' + sanitize(name) + '</p>');", filename: TS, errors: html },
    { code: "const { escape } = require('mysql'); res.send('<p>' + escape(name) + '</p>');", filename: TS, errors: html },
    // Raw template variables bound to runtime values.
    {
      code: `${NUNJUCKS} nunjucks.renderString('<div class="bio">{{ bio | safe }}</div>', { bio: data });`,
      filename: TS,
      errors: raw,
    },
    { code: "env.renderString('<p>{{ bio | trim | safe }}</p>', { bio: input });", filename: TS, errors: raw },
    {
      code: "const TEMPLATE = '<p><%- bio %></p>'; const ctx = { bio: profile.bio }; ejs.render(TEMPLATE, ctx);",
      filename: TS,
      errors: raw,
    },
    {
      code: `${NUNJUCKS} function h(req) { const data = \`\${req.headers['x-forwarded-for']}\`; return nunjucks.renderString('<div>{{ bio | safe }}</div>', { bio: data }); }`,
      filename: TS,
      errors: raw,
    },
    { code: "ejs.render('<p><%- user.bio %></p>', { user: req.user });", filename: TS, errors: raw },
    { code: "ejs.render('<p><%- locals.bio %></p>', { bio: input });", filename: TS, errors: raw },
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ user.bio | safe }}</p>', { user: req.user });`, filename: TS, errors: raw },
    {
      code: `${NUNJUCKS} nunjucks.renderString('<p>{% autoescape false %}{{ bio }}{% endautoescape %}</p>', { bio: input });`,
      filename: TS,
      errors: raw,
    },
    {
      code: `${NUNJUCKS} nunjucks.configure({ autoescape: false }); nunjucks.renderString('<p>{{ bio }}</p>', { bio: input });`,
      filename: TS,
      errors: raw,
    },
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ bio | safe | escape }}</p>', { bio: input });`, filename: TS, errors: raw },
    // Autoescaped template values in places HTML escaping does not cover.
    { code: `${NUNJUCKS} nunjucks.renderString('<a href="{{ url }}">x</a>', { url: input });`, filename: TS, errors: where },
    { code: "ejs.render('<script>var user = <%= name %>;</script>', { name: input });", filename: TS, errors: where },
    // A module that does not escape, or an export that is not an escaper.
    { code: "import { encode } from 'base64-thing'; res.send('<p>' + encode(comment) + '</p>');", filename: TS, errors: html },
    { code: "import { decode } from 'he'; res.send('<p>' + decode(comment) + '</p>');", filename: TS, errors: html },
    // A Unicode letter class next to `<` and `>` still admits markup.
    {
      code: "function h(req, res) { const bio = String(req.body.bio); if (!/^[\\p{L}<>]+$/u.test(bio)) return; res.send('<p>' + bio + '</p>'); }",
      filename: TS,
      errors: html,
    },
    // Accumulators, joins, helpers and `String.raw`.
    {
      code: "function h(res, name) { let html = '<ul>'; html += '<li>' + name + '</li>'; html += '</ul>'; res.send(html); }",
      filename: TS,
      errors: html,
    },
    {
      code: "function h(res, rows) { let html = '<ul>'; rows.forEach((row) => { html = html + `<li>${row.title}</li>`; }); res.send(html); }",
      filename: TS,
      errors: html,
    },
    {
      code: 'function h(res, items) { res.send(`<ul>${items.map((item) => `<li>${item.name}</li>`).join(\'\')}</ul>`); }',
      filename: TS,
      errors: html,
    },
    {
      code: "function h(res, items) { res.send(['<ul>', ...items, '</ul>'].join('')); }",
      filename: TS,
      errors: html,
    },
    {
      code: 'function row(cell) { return `<td>${cell}</td>`; } function h(res, name) { res.send(`<tr>${row(name)}</tr>`); }',
      filename: TS,
      errors: html,
    },
    {
      code: 'function link(url) { return `<a href="${url}">x</a>`; } function h(res, next) { res.send(link(escapeHtml(next))); }',
      filename: TS,
      errors: where,
    },
    { code: 'res.send(String.raw`<p>${name}</p>`);', filename: TS, errors: html },
    // TS wrappers and request-shaped `.length`.
    { code: 'function h(res, name: unknown) { (res as Res).send(`<p>${name as string}</p>`); }', filename: TS, errors: html },
    { code: 'function h(res, name) { res!.send(`<p>${name!}</p>`); }', filename: TS, errors: html },
    { code: 'function h(req, res) { res.send(`<p>${req.query.items.length} items</p>`); }', filename: TS, errors: html },
    // A script scheme, written or assembled from a runtime part, makes the rest of the URL code.
    { code: 'res.send(`<a href="javascript:${escapeHtml(code)}">x</a>`);', filename: TS, errors: where },
    { code: 'res.send(`<a href="${encodeURIComponent(scheme)}:${escapeHtml(rest)}">x</a>`);', filename: TS, errors: where },
    { code: 'function h(res, items) { res.send(`<ul>${items.map((item) => { const name = item.name; return `<li>${name}</li>`; }).join(\'\')}</ul>`); }', filename: TS, errors: html },
    { code: "ejs.render('<%% <%- bio %>', { bio: input });", filename: TS, errors: raw },
    { code: `${NUNJUCKS} nunjucks.renderString('<p>{{ user["bio"] | safe }}</p>', { user: input });`, filename: TS, errors: raw },
    {
      code: `${NUNJUCKS} const env = new nunjucks.Environment(null, { autoescape: false }); env.renderString('<p>{{ bio }}</p>', { bio: input });`,
      filename: TS,
      errors: raw,
    },
    // Other response sinks.
    { code: "function h(reply, name) { reply.type('text/html').send('<p>' + name + '</p>'); }", filename: TS, errors: html },
    {
      code: "function h(reply, name) { reply.header('content-type', 'text/html'); reply.send(`<p>${name}</p>`); }",
      filename: TS,
      errors: html,
    },
    { code: 'function h(ctx) { ctx.body = `<p>${ctx.query.q}</p>`; }', filename: TS, errors: html },
    { code: 'function h(ctx, q) { ctx.response.body = `  <p>${q}</p>`; }', filename: TS, errors: html },
    { code: "function h(ctx, q) { ctx.body = q + '<br>'; }", filename: TS, errors: html },
    {
      code: "export async function POST(req) { const { name } = await req.json(); return new Response(`<p>${name}</p>`, { headers: [['Content-Type', 'text/html']] }); }",
      filename: TS,
      errors: html,
    },
    { code: "function h(ctx, q) { ctx.type = 'html'; ctx.body = 'Results: ' + q + '<br>'; }", filename: TS, errors: html },
    {
      code: "export function GET(req) { const q = new URL(req.url).searchParams.get('q'); return new Response(`<p>${q}</p>`, { headers: { 'Content-Type': 'text/html' } }); }",
      filename: TS,
      errors: html,
    },
    {
      code: "import { NextResponse } from 'next/server'; export function GET(q) { return new NextResponse('<p>' + q + '</p>', { headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) }); }",
      filename: TS,
      errors: html,
    },
    {
      code: "import { Controller, Get, Header, Query } from '@nestjs/common'; @Controller() class C { @Get() @Header('Content-Type', 'text/html') find(@Query('q') q: string) { return `<h1>${q}</h1>`; } }",
      filename: TS,
      errors: html,
    },
    {
      code: "function h(res, user) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>' + user.name + '</p>'); }",
      filename: TS,
      errors: html,
    },
    // A global DOMPurify config reaches every import of the module.
    {
      code: "import { sanitize, setConfig } from 'isomorphic-dompurify'; setConfig({ ADD_TAGS: ['script'] }); export function h(req, res) { res.send('<div>' + sanitize(req.query.q) + '</div>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "import DOMPurify, { sanitize } from 'isomorphic-dompurify'; DOMPurify.setConfig({ ADD_TAGS: ['script'] }); res.send('<div>' + sanitize(q) + '</div>');",
      filename: TS,
      errors: html,
    },
    {
      code: "const { sanitize, setConfig: configure } = require('isomorphic-dompurify'); configure({ ALLOWED_URI_REGEXP: /.*/ }); res.send('<div>' + sanitize(q) + '</div>');",
      filename: TS,
      errors: html,
    },
    {
      code: `${PURIFY} const P = DOMPurify; P.setConfig({ ADD_ATTR: ['onerror'] }); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`,
      filename: TS,
      errors: html,
    },
    { code: `${PURIFY} configure(DOMPurify); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} DOMPurify.sanitize = (s) => s; res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS, errors: html },
    {
      code: "import { sanitize, setConfig } from 'isomorphic-dompurify'; setConfig(loadConfig()); res.send('<div>' + sanitize(q) + '</div>');",
      filename: TS,
      errors: html,
    },
    // `setConfig` invoked through `.call` or `.apply`.
    { code: `${PURIFY} DOMPurify.setConfig.call(null, { ADD_TAGS: ['script'] }); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} DOMPurify.setConfig.apply(null, [{ ADD_ATTR: ['onerror'] }]); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} DOMPurify.setConfig.apply(null, configs); res.send('<p>' + DOMPurify.sanitize(q) + '</p>');`, filename: TS, errors: html },
    { code: "import { sanitize, setConfig } from 'isomorphic-dompurify'; setConfig.call(undefined, { ADD_TAGS: ['script'] }); res.send('<div>' + sanitize(q) + '</div>');", filename: TS, errors: html },
    { code: "import { sanitize, setConfig } from 'isomorphic-dompurify'; setConfig.apply(undefined, [{ ADD_TAGS: ['script'] }]); res.send('<div>' + sanitize(q) + '</div>');", filename: TS, errors: html },
    // DOMPurify options that skip the URI check, allow data URLs on documents, or parse another way.
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { ADD_URI_SAFE_ATTR: ['href'] }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { ADD_URI_SAFE_ATTR: attrs }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { ADD_DATA_URI_TAGS: ['iframe'] }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { NAMESPACE: 'http://www.w3.org/2000/svg' }) + '</p>');`, filename: TS, errors: html },
    { code: `${PURIFY} res.send('<p>' + DOMPurify.sanitize(q, { PARSER_MEDIA_TYPE: 'application/xhtml+xml' }) + '</p>');`, filename: TS, errors: html },
    // Writes to the shared defaults of sanitize-html and xss.
    { code: `${SANITIZE} sanitizeHtml.defaults.allowedAttributes = false; res.send('<p>' + sanitizeHtml(q) + '</p>');`, filename: TS, errors: html },
    { code: `${SANITIZE} sanitizeHtml.defaults.allowedTags.push('script'); res.send('<p>' + sanitizeHtml(q) + '</p>');`, filename: TS, errors: html },
    {
      code: `${SANITIZE} sanitizeHtml.defaults.allowedAttributes['*'] = ['onerror']; res.send('<p>' + sanitizeHtml(q, { allowedTags: ['img'] }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    { code: `${SANITIZE} const d = sanitizeHtml.defaults; d.allowedTags.push('script'); res.send('<p>' + sanitizeHtml(q) + '</p>');`, filename: TS, errors: html },
    { code: `${SANITIZE} Object.assign(sanitizeHtml.defaults, overrides); res.send('<p>' + sanitizeHtml(q) + '</p>');`, filename: TS, errors: html },
    {
      code: `${SANITIZE} const tags = { list: sanitizeHtml.defaults.allowedTags }; tags.list.push('script'); res.send('<p>' + sanitizeHtml(q) + '</p>');`,
      filename: TS,
      errors: html,
    },
    { code: `${SANITIZE} setup(sanitizeHtml); res.send('<p>' + sanitizeHtml(q) + '</p>');`, filename: TS, errors: html },
    { code: "const xss = require('xss'); xss.whiteList.img.push('onerror'); res.send('<p>' + xss(q) + '</p>');", filename: TS, errors: html },
    {
      code: "import { filterXSS, whiteList } from 'xss'; whiteList.img.push('onerror'); res.send('<p>' + filterXSS(q) + '</p>');",
      filename: TS,
      errors: html,
    },
    // sanitize-html globs and data URLs that reach event handlers or documents.
    { code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedAttributes: { '*': ['o*'] } }) + '</p>');`, filename: TS, errors: html },
    { code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedAttributes: { iframe: ['s*'] } }) + '</p>');`, filename: TS, errors: html },
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedTags: ['iframe'], allowedSchemesByTag: { iframe: ['data'] } }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    {
      code: `${SANITIZE} res.send('<p>' + sanitizeHtml(q, { allowedTags: ['iframe'], allowedSchemes: ['https', 'data'] }) + '</p>');`,
      filename: TS,
      errors: html,
    },
    // React rendering writes `dangerouslySetInnerHTML` as is.
    {
      code: "import { renderToString } from 'react-dom/server'; export function h(req, res) { res.send('<div id=\"root\">' + renderToString(<div dangerouslySetInnerHTML={{ __html: req.query.q }} />) + '</div>'); }",
      filename: TSX,
      errors: html,
    },
    {
      code: "import { renderToStaticMarkup } from 'react-dom/server'; function Bio({ bio }) { return <p dangerouslySetInnerHTML={{ __html: bio }} />; } res.send('<main>' + renderToStaticMarkup(<Bio bio={q} />) + '</main>');",
      filename: TSX,
      errors: html,
    },
    {
      code: "import { createElement } from 'react'; import { renderToString } from 'react-dom/server'; const el = createElement('div', { dangerouslySetInnerHTML: { __html: q } }); res.send('<main>' + renderToString(el) + '</main>');",
      filename: TS,
      errors: html,
    },
    // A React render is markup on its own, with no author tag around it.
    {
      code: "import { renderToString } from 'react-dom/server'; export function h(req, res) { res.send(renderToString(<div dangerouslySetInnerHTML={{ __html: req.query.q }} />)); }",
      filename: TSX,
      errors: html,
    },
    {
      code: "import { renderToString } from 'react-dom/server'; app.use(async (ctx) => { ctx.type = 'html'; ctx.body = renderToString(<p dangerouslySetInnerHTML={{ __html: ctx.query.q }} />); });",
      filename: TSX,
      errors: html,
    },
    {
      code: "import { renderToStaticMarkup } from 'react-dom/server'; http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(renderToStaticMarkup(<p dangerouslySetInnerHTML={{ __html: req.url }} />)); });",
      filename: TSX,
      errors: html,
    },
    // EJS options and settings that switch escaping off or change the tags.
    { code: "ejs.render('<p><%= bio %></p>', { bio: input }, { escape: (s) => s });", filename: TS, errors: raw },
    { code: "ejs.render('<p><?- bio ?></p>', { bio: input }, { delimiter: '?' });", filename: TS, errors: raw },
    { code: "ejs.render('<p><?- bio ?></p>', { bio: input, delimiter: '?' });", filename: TS, errors: raw },
    { code: "ejs.render('<p>[%- bio %]</p>', { bio: input }, { openDelimiter: '[', closeDelimiter: ']' });", filename: TS, errors: raw },
    // With no options argument, a spread or computed key in the data may set `escape` or a delimiter.
    { code: "ejs.render('<p><%= bio %></p>', { ...opts, bio: input });", filename: TS, errors: raw },
    { code: "ejs.render('<p><%= bio %></p>', { [key]: fn, bio: input });", filename: TS, errors: raw },
    { code: "ejs.render('<p><%- it.bio %></p>', { bio: input }, { localsName: 'it' });", filename: TS, errors: raw },
    { code: "ejs.render('<p><%= bio %></p>', { bio: input }, options);", filename: TS, errors: raw },
    { code: "ejs.render('<p><%= bio %></p>', { bio: input }, { outputFunctionName: 'echo' });", filename: TS, errors: raw },
    { code: "ejs.escapeXML = (s) => s; ejs.render('<p><%= bio %></p>', { bio: input });", filename: TS, errors: raw },
    { code: "ejs.delimiter = '?'; ejs.render('<p><?- bio ?></p>', { bio: input });", filename: TS, errors: raw },
    // Constant text read as author text in a script.
    {
      code: "import serialize from 'serialize-javascript'; const OPEN = \"window.S = JSON.parse('\"; export function h(req, res) { res.send(`<script>${OPEN}${serialize(req.query.q)}')</script>`); }",
      filename: TS,
      errors: where,
    },
    {
      code: "import serialize from 'serialize-javascript'; const Q = \"'\"; const OPEN = 'var s = ' + Q; export function h(req, res) { res.send(`<script>${OPEN}${serialize(req.query.q)}${Q}</script>`); }",
      filename: TS,
      errors: where,
    },
    // A dotted escaper name says nothing about an object, class or parameter of this file.
    {
      code: "const utils = { escapeHtml: (s) => s }; res.send('<p>' + utils.escapeHtml(q) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['utils.escapeHtml'] }],
      errors: html,
    },
    {
      code: "class Utils { static escapeHtml(s) { return s; } } res.send('<p>' + Utils.escapeHtml(q) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['Utils.escapeHtml'] }],
      errors: html,
    },
    {
      code: "function h(utils, q, res) { res.send('<p>' + utils.escapeHtml(q) + '</p>'); }",
      filename: TS,
      options: [{ sanitizers: ['utils.escapeHtml'] }],
      errors: html,
    },
    // A configured escaper name says nothing once this file writes it, the object it is read from, or that object's members.
    { code: "let utils = require('./utils'); utils = { escapeHtml: (s) => s }; res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "const utils = require('./utils'); utils.escapeHtml = (s) => s; res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "import utils from './utils'; utils.escapeHtml = (s) => s; res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "import utils from './utils'; Object.assign(utils, { escapeHtml: (s) => s }); res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "import utils from './utils'; Object.defineProperty(utils, 'escapeHtml', { value: (s) => s }); res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "utils.escapeHtml = (s) => s; res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "import utils from './utils'; utils['escapeHtml'] = (s) => s; res.send('<p>' + utils.escapeHtml(q) + '</p>');", filename: TS, options: [{ sanitizers: ['utils.escapeHtml'] }], errors: html },
    { code: "let escapeHtml = require('escape-html'); escapeHtml = (s) => s; res.send('<p>' + escapeHtml(q) + '</p>');", filename: TS, errors: html },
    { code: "let escapeHtml = require('./esc'); escapeHtml = (s) => s; res.send('<p>' + escapeHtml(q) + '</p>');", filename: TS, errors: html },
    { code: "escapeHtml = (s) => s; res.send('<p>' + escapeHtml(q) + '</p>');", filename: TS, errors: html },
    // A helper's parameter written in its body.
    {
      code: "function wrap(s) { const t = (s = other.q); return s; } res.send('<p>' + wrap(escapeHtml(q)) + '</p>');",
      filename: TS,
      errors: html,
    },
    // A `<script>` inside an escaped script keeps the element open past `</script>`.
    {
      code: "export function h(req, res) { res.send(`<script><!--<script></script>\n${escapeHtml(req.query.q)}\n</script>`); }",
      filename: TS,
      errors: where,
    },
    {
      code: "export function h(req, res) { res.send(`<script>/*<!--<SCRIPT>*/</script >${escapeHtml(req.query.q)}--></script>`); }",
      filename: TS,
      errors: where,
    },
    // Script lexer corners: comment ends, spreads, number dots, private names, name characters and escapes.
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = 1// n\ntypeof /'/; var s = '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>a/**/in /'/; var s = '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var a = [...typeof /'/, '${serialize(req.query.q)}']</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var x = 1.\ntypeof /'/; var s = '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>class A { #in = 4; f() { return this.#in / 2, '/ ${serialize(req.query.q)} ' } }</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var x\u00B7in = 4, r = x\u00B7in / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>var \\\\u{62}do = 4, r = \\\\u{62}do / 2, s = '/ ${serialize(req.query.q)} '</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script type=\"module\">export default /'/; var s = '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript';\nexport function h(req, res) { res.send(`<script>class A extends /'/.constructor {} var s = '${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    // A data block still ends at `</script>`; a type the rule cannot read may be script.
    {
      code: "export function h(req, res) { res.send(`<script type=\"application/json\">${JSON.stringify(req.query.q)}</script>`); }",
      filename: TS,
      errors: html,
    },
    {
      code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"${escapeHtml(type)}\">'${serialize(req.query.q)}'</script>`); }",
      filename: TS,
      errors: where,
    },
    {
      code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\" text/JavaScript \" type=\"application/json\">'${serialize(req.query.q)}'</script>`); }",
      filename: TS,
      errors: where,
    },
    // A URL prefix past the length kept is shortened to what the browser reads, or counts as code.
    { code: `export function h(req, res) { res.send(\`<a href="${' '.repeat(300)}\${escapeHtml(req.query.q)}">x</a>\`); }`, filename: TS, errors: where },
    { code: `export function h(req, res) { res.send(\`<a href="${'\\n'.repeat(300)}\${escapeHtml(req.query.q)}">x</a>\`); }`, filename: TS, errors: where },
    { code: `export function h(req, res) { res.send(\`<a href="java${'\\t'.repeat(300)}script:\${escapeHtml(req.query.q)}">x</a>\`); }`, filename: TS, errors: where },
    { code: `export function h(req, res) { res.send(\`<a href="&#${'0'.repeat(300)}106;avascript:\${escapeHtml(req.query.q)}">x</a>\`); }`, filename: TS, errors: where },    // Only JSON and plain text never run; a library may compile and run any other type, and a character reference hides the type.
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text/x-template\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text/babel\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text/jsx\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text/typescript\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text/javascript; charset=utf-8\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text&#47;javascript\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"&#109;odule\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"text&sol;javascript\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "import serialize from 'serialize-javascript'; export function h(req, res) { res.send(`<script type=\"application&#47;json\">'${serialize(req.query.q)}'</script>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<script type='text/x-template'><p>${escapeHtml(req.query.q)}</p></script>`); }", filename: TS, errors: where },
    // Markup passed through a call or tag from elsewhere, a placeholder, or an array accumulator.
    { code: "export function h(req, res) { res.send(layout(`<h1>${req.query.q}</h1>`)); }", filename: TS, errors: html },
    { code: "import dedent from 'dedent'; export function h(req, res) { res.send(dedent`<h1>${req.query.q}</h1>`); }", filename: TS, errors: html },
    { code: "import { html } from 'common-tags'; export function h(req, res) { res.send(html`<h1>${req.query.q}</h1>`); }", filename: TS, errors: html },
    { code: "export function h(req, res) { const page = `<h1>${req.query.q}</h1>`; res.send(page.trim()); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<li>'.concat(req.query.q, '</li>')); }", filename: TS, errors: html },
    { code: "const TPL = '<h1>{{name}}</h1>'; export function h(req, res) { res.send(TPL.replace('{{name}}', req.query.q)); }", filename: TS, errors: html },
    {
      code: "const TPL = '<a href=\"{{url}}\">{{name}}</a>'; export function h(req, res) { res.send(TPL.replace(/\\{\\{name\\}\\}/g, escapeHtml(req.query.n)).replace('{{url}}', escapeHtml(req.query.u))); }",
      filename: TS,
      errors: [...where, ...where],
    },
    // A string replacement applies `$` patterns, which escape-html leaves alone.
    { code: "const TPL = '<h1>{{name}}</h1>'; export function h(req, res) { res.send(TPL.replace('{{name}}', escapeHtml(req.query.q))); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send('<div title=\"{{n}}\">x</div>'.replace('{{n}}', escapeHtml(req.query.q))); }", filename: TS, errors: where },
    // A later placeholder may be found inside an earlier value, and the replacement then lands there.
    {
      code: "const TPL = '<a href=\"{{url}}\">{{name}}</a>'; export function h(req, res) { res.send(TPL.replace('{{url}}', () => escapeHtml(req.query.u)).replace('{{name}}', () => escapeHtml(req.query.n))); }",
      filename: TS,
      errors: [...where, ...where],
    },
    // A call that may move, decode or rewrite the markup it is given stays opaque, and every other value it is given may land anywhere.
    { code: "export function h(req, res) { res.send('<div>' + layout(req.query.t, `<main>${escapeHtml(req.query.q)}</main>`)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + layout(`<main>${escapeHtml(req.query.q)}</main>`, req.query.t)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send(layout(`<main>${escapeHtml(req.query.q)}</main>`, req.query.t)); }", filename: TS, errors: html },
    { code: "app.use(async (ctx) => { ctx.body = '<div>' + layout(ctx.query.t, `<main>${escapeHtml(ctx.query.q)}</main>`); });", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + `<p>${escapeHtml(req.query.q)}</p>`.padStart(100, req.query.t)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send(`<p>${escapeHtml(req.query.q)}</p>`.padEnd(100, req.query.t)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + decodeURIComponent(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + unescape(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + atob(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "import { decode } from 'html-entities'; export function h(req, res) { res.send('<div>' + decode(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "import { unesc } from './text'; export function h(req, res) { res.send('<div>' + unesc(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + `<p>${escapeHtml(req.query.q)}</p>`.split('&lt;').join('<')); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + `<p>${escapeHtml(req.query.q)}</p>`.replace(/&lt;/g, '<')); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + `<p>${escapeHtml(req.query.q)}</p>`.replaceAll('&lt;', '<')); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send(`<p>${escapeHtml(req.query.q)}</p>`.replaceAll('&lt;', '<')); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<script>' + `</script><p>${escapeHtml(req.query.q)}</p>`.slice(9)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + `<p>${escapeHtml(req.query.q)}</p>`.substring(0, 8)); }", filename: TS, errors: html },
    { code: "export function h(req, res) { res.send('<div>' + req.query.render(`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "export function h(req, res, helpers) { res.send('<div>' + helpers[req.query.t](`<p>${escapeHtml(req.query.q)}</p>`)); }", filename: TS, errors: html },
    { code: "import dedent from 'dedent'; export function h(req, res) { res.send('<div>' + dedent`<p>${escapeHtml(req.query.q)}</p>`); }", filename: TS, errors: html },
    {
      code: "const TPL = '<h1>{{name}}</h1>'; export function h(req, res, data) { res.send(TPL.replace(/\\{\\{(\\w+)\\}\\}/g, (m, k) => data[k])); }",
      filename: TS,
      errors: html,
    },
    {
      code: "export function h(res, list) { const rows = []; for (const r of list) rows.push('<li>' + r.name + '</li>'); res.send('<ul>' + rows.join('') + '</ul>'); }",
      filename: TS,
      errors: html,
    },
    {
      code: "export function h(res, items) { res.send(`<ul>${items.map((i) => { if (i.hidden) return ''; return `<li>${i.name}</li>`; }).join('')}</ul>`); }",
      filename: TS,
      errors: html,
    },
    // A Nest route handler's string is sent as text/html on the Express platform.
    {
      code: "import { Controller, Get, Query } from '@nestjs/common'; @Controller() class C { @Get() find(@Query('q') q: string) { return `<h1>${q}</h1>`; } }",
      filename: TS,
      errors: html,
    },
    {
      code: "import { Controller, Header, Post, Body } from '@nestjs/common'; @Controller() class C { @Post() @Header('Content-Type', type) save(@Body() b) { return `<p>${b.name}</p>`; } }",
      filename: TS,
      errors: html,
    },
    {
      code: "import * as common from '@nestjs/common'; @common.Controller() class C { @common.Get() find(@common.Query('q') q = '') { return `<h1>${q}</h1>`; } }",
      filename: TS,
      errors: html,
    },
    { code: "export function h(req, res) { res.send(layout('<h1>'.concat(req.query.q, '</h1>'))); }", filename: TS, errors: html },
    // A `data:` page in a frame, comment ends browsers accept, and URL text written with character references.
    { code: "export function h(req, res) { res.send(`<iframe src=\"data:text/html,${escapeHtml(req.query.q)}\"></iframe>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<object data=\"data:text/html;base64,${encodeURIComponent(req.query.q)}\"></object>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<!--><script>${escapeHtml(req.query.q)}</script>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<!---><script>${escapeHtml(req.query.q)}</script>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<!-- a --!><script>${escapeHtml(req.query.q)}</script>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<a href=\"&#106;avascript:${escapeHtml(req.query.q)}\">x</a>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<a href=\"javascript&colon;${escapeHtml(req.query.q)}\">x</a>`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<a href=\"&#x6A${escapeHtml(req.query.q)}\">x</a>`); }", filename: TS, errors: where },
    // Meta refresh URLs and SVG animation values.
    { code: "export function h(req, res) { res.send(`<meta http-equiv=\"refresh\" content=\"0;url=${escapeHtml(req.query.q)}\">`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<meta http-equiv=\"Refresh\" content=\"0; URL='${escapeHtml(req.query.q)}'\">`); }", filename: TS, errors: where },
    { code: "export function h(req, res) { res.send(`<svg><a><animate attributeName=\"href\" values=\"#;${escapeHtml(req.query.q)}\"/><set attributeName=\"href\" to=\"${escapeHtml(req.query.q)}\"/></a></svg>`); }", filename: TS, errors: [...where, ...where] },
    // Template outputs read through a bracket key or a `set` alias.
    { code: "ejs.render('<p><%- locals[\"bio\"] %></p>', { bio: input });", filename: TS, errors: raw },
    { code: `${NUNJUCKS} nunjucks.renderString('{% set b = bio | safe %}<p>{{ b }}</p>', { bio: input });`, filename: TS, errors: raw },
    // Response headers in a const or a Headers instance, a Fastify return, Koa branches, a removed type.
    {
      code: "export function GET(req) { const q = new URL(req.url).searchParams.get('q'); const headers = { 'Content-Type': 'text/html' }; return new Response(`<p>${q}</p>`, { headers }); }",
      filename: TS,
      errors: html,
    },
    {
      code: "export function GET(req) { const q = new URL(req.url).searchParams.get('q'); const headers = new Headers(); headers.set('Content-Type', 'text/html; charset=utf-8'); return new Response(`<p>${q}</p>`, { headers }); }",
      filename: TS,
      errors: html,
    },
    {
      code: "fastify.get('/', async (request, reply) => { reply.type('text/html'); return `<h1>${request.query.q}</h1>`; });",
      filename: TS,
      errors: html,
    },
    { code: "function h(ctx, ok) { ctx.body = ok ? 'Done' : `<p>${ctx.query.q}</p>`; }", filename: TS, errors: html },
    {
      code: "function h(res, q) { res.type('text/plain'); res.removeHeader('Content-Type'); res.send('<p>' + q + '</p>'); }",
      filename: TS,
      errors: html,
    },  ],
});
