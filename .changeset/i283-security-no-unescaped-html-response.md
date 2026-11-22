---
'@noctcore/eslint-plugin-security': minor
---

New opt-in rule `no-unescaped-html-response`, for server-side XSS. It reports a runtime value written unescaped into HTML: `res.send` / `res.end` / `res.write` (receivers in `responseObjects`, default `res` and `response`, also after `res.status(...)` and similar chained calls) of a template or `+` concatenation whose text contains a tag, and a raw template variable (`{{ key | safe }}` in nunjucks `renderString`, `<%- key %>` in `ejs.render`) bound to a runtime value in a literal context object. It judges the HTML, not the value's source, so a database value counts like a request value.

A part is safe when it is a literal or `const` literal, a number, the result of an escaper or sanitizer in `sanitizers` (default `escapeHtml`, `escapeHTML`, `htmlEscape`, `encodeHTML`, `escape`, `he.encode`, `he.escape`, `sanitize`, `sanitizeHtml`, `xss`, `filterXSS`, `renderToString`, `renderToStaticMarkup`; escapers imported from `he`, `escape-html`, `lodash` and similar modules count under any local name; the outermost call decides), a `.replace` chain encoding `&`, `<`, `>` and `"`, or a value checked before the response against an allowlist or an anchored regex that admits none of `<>&"'` and backtick. `res.json`, non-HTML bodies and functions that first set a non-HTML content type are left alone.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. Enable it with `'noctcore-security/no-unescaped-html-response': 'error'`.
