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
  ],
});
