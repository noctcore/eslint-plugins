import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnescapedHtmlResponseRule } from '../../src/rules/no-unescaped-html-response';

const TS = 'handler.ts';
const html = [{ messageId: 'unescapedHtmlResponse' as const }];
const raw = [{ messageId: 'rawTemplateValue' as const }];

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
    { code: "res.status(200).send(`<p>${he.encode(name)}</p>`);", filename: TS },
    {
      code: "const clean = isoDompurify.sanitize(comment); const shown = clean; res.send('<div>' + shown + '</div>');",
      filename: TS,
    },
    { code: "res.end('<section>' + DOMPurify.sanitize(marked.parse(body)) + '</section>');", filename: TS },
    {
      code: "const safe = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); res.send(`<p>${safe}</p>`);",
      filename: TS,
    },
    { code: "res.send('<p>' + items.length + ' items, ' + Number(total) + ' total</p>');", filename: TS },
    { code: 'res.send(`<p>${price.toFixed(2)}</p>`);', filename: TS },
    { code: "res.send(`<li class=\"${active ? 'on' : 'off'}\">x</li>`);", filename: TS },
    // Values checked before the response.
    {
      code: "function h(req, res) { const sort = String(req.query.sort); if (!/^(asc|desc)$/.test(sort)) { res.status(400).json({ error: 'sort' }); return; } res.send('<p>' + sort + '</p>'); }",
      filename: TS,
    },
    {
      code: "function h(req, res) { const tag = req.query.tag; if (!/^[a-zA-Z0-9 _.#%-]+$/.test(tag)) return; res.send(`<p>${tag}</p>`); }",
      filename: TS,
    },
    // A non-HTML content type set first.
    { code: "function h(res, name) { res.type('text/plain'); res.send('<p>' + name + '</p>'); }", filename: TS },
    {
      code: "function h(res, name) { res.set('Content-Type', 'application/json'); res.end(`{\"html\": \"<p>${name}</p>\"}`); }",
      filename: TS,
    },
    // A configured escaper.
    {
      code: "res.send('<p>' + toHtml(name) + '</p>');",
      filename: TS,
      options: [{ sanitizers: ['toHtml'] }],
    },
    // Templates: escaped by default, or a raw key bound to a safe value.
    { code: "nunjucks.renderString('<p>{{ bio }}</p>', { bio: input });", filename: TS },
    { code: "nunjucks.renderString('<p>{{ bio | safe }}</p>', { bio: DOMPurify.sanitize(input) });", filename: TS },
    {
      code: "const shown = input.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); nunjucks.renderString('<p>{{ bio | safe }}</p>', { bio: shown });",
      filename: TS,
    },
    { code: "ejs.render('<p><%= bio %></p>', { bio: input });", filename: TS },
    { code: "nunjucks.renderString(template, { bio: input });", filename: TS },
    { code: "nunjucks.renderString('<p>{{ bio | safe }}</p>', { title: input, bio: '<b>fixed</b>' });", filename: TS },
    // Escapers imported from their modules under any name.
    { code: "import { encode } from 'he'; res.send('<p>' + encode(comment) + '</p>');", filename: TS },
    { code: "import * as entities from 'he'; res.send(`<p>${entities.encode(comment)}</p>`);", filename: TS },
    { code: "const esc = require('escape-html'); res.send('<p>' + esc(comment) + '</p>');", filename: TS },
    { code: "const { escape: e } = require('lodash'); res.send('<p>' + e(comment) + '</p>');", filename: TS },
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
  ],
  invalid: [
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
    { code: "res.send('<div>' + marked.parse(DOMPurify.sanitize(body)) + '</div>');", filename: TS, errors: html },
    // An escape chain that misses a character.
    { code: "res.send('<p>' + input.replace(/</g, '&lt;') + '</p>');", filename: TS, errors: html },
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
    // An HTML content type does not excuse it.
    { code: "function h(res, name) { res.type('html'); res.send('<p>' + name + '</p>'); }", filename: TS, errors: html },
    // Raw template variables bound to runtime values.
    { code: "nunjucks.renderString('<div class=\"bio\">{{ bio | safe }}</div>', { bio: data });", filename: TS, errors: raw },
    { code: "env.renderString('<p>{{ bio | trim | safe }}</p>', { bio: input });", filename: TS, errors: raw },
    {
      code: "const TEMPLATE = '<p><%- bio %></p>'; const ctx = { bio: profile.bio }; ejs.render(TEMPLATE, ctx);",
      filename: TS,
      errors: raw,
    },
    {
      code: "function h(req) { const data = `${req.headers['x-forwarded-for']}`; return nunjucks.renderString('<div>{{ bio | safe }}</div>', { bio: data }); }",
      filename: TS,
      errors: raw,
    },
    // A module that does not escape, or an export that is not an escaper.
    { code: "import { encode } from 'base64-thing'; res.send('<p>' + encode(comment) + '</p>');", filename: TS, errors: html },
    { code: "import { decode } from 'he'; res.send('<p>' + decode(comment) + '</p>');", filename: TS, errors: html },
    // A Unicode letter class next to `<` and `>` still admits markup.
    {
      code: "function h(req, res) { const bio = String(req.body.bio); if (!/^[\\p{L}<>]+$/u.test(bio)) return; res.send('<p>' + bio + '</p>'); }",
      filename: TS,
      errors: html,
    },
  ],
});
