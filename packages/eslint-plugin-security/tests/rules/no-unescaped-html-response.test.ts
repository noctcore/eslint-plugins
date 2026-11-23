import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnescapedHtmlResponseRule } from '../../src/rules/no-unescaped-html-response';

const TS = 'handler.ts';
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
    {
      code: "import { Controller, Get, Query } from '@nestjs/common'; @Controller() class C { @Get() find(@Query('q') q: string) { return `<h1>${q}</h1>`; } }",
      filename: TS,
    },
  ],
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
  ],
});
