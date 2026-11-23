# `noctcore-security/no-unescaped-html-response`

> HTML built from a runtime value and sent as a response (`res.send`, `ctx.body`, `new Response`, ...), or bound to a raw template variable, must escape or sanitize the value for where it lands.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Express sends a string body as `text/html`, so a value concatenated into it is parsed as markup. A
name of `<img src=x onerror=alert(1)>` runs as script in whoever opens the page:

```ts bad
export function greet(req, res) {
  res.send('<p>Hello ' + req.query.name + '</p>');
}
```

```ts good
import escapeHtml from 'escape-html';

export function greet(req, res) {
  res.send('<p>Hello ' + escapeHtml(req.query.name) + '</p>');
}
```

Escaping is only enough where it is enough. An escaped value still runs as script at the start of
a URL attribute (`javascript:alert(1)` has nothing to escape), inside an unquoted attribute (a space
starts a new one), in an event handler (the browser decodes the entities before running it) and in
a `<script>` or `<style>` element (escaping stops nothing there):

```ts bad
import escapeHtml from 'escape-html';

export function link(req, res) {
  res.send(`<a href="${escapeHtml(req.query.next)}">Continue</a>`);
}
```

```ts good
export function link(req, res) {
  res.send(`<a href="https://example.com/continue?next=${encodeURIComponent(req.query.next)}">Continue</a>`);
}
```

Template engines escape by default, which is why a value that skips escaping is marked by hand
(`{{ bio | safe }}` in nunjucks, `<%- bio %>` in EJS). That marker is where reflected and stored XSS
come back.

The rule judges the HTML being built, not where each value came from, the way
`no-shell-interpolation` judges a command string: a value read from the database (stored XSS)
counts the same as one read from the request.

## What it flags

A body that, followed through the code that builds it, has author text containing a tag (`<`
followed by a letter, `/` or `!`) and a runtime part that is not safe where it lands (see below).
The report is on that part. The bodies it reads:

- `res.send(x)`, `res.end(x)` and `res.write(x)` on a receiver in `responseObjects` (`res`,
  `response`), also after calls that return the response (`res.status(200).send(x)`);
- `reply.send(x)` on a receiver in `replyObjects` (`reply`) once an HTML content type is set on it:
  Fastify sends a string as text otherwise;
- `ctx.body = x` and `ctx.response.body = x` on a receiver in `contextObjects` (`ctx`), unless the
  body starts with author text that is not `<` and no content type is set: Koa sends that as text;
- `new Response(x, init)` and `new NextResponse(x, init)` (from `next/server`) whose literal `init`
  sets an HTML content type, as in a Next route handler;
- the return value of a Nest handler with `@Header('Content-Type', 'text/html')` from
  `@nestjs/common`.

The body is followed through templates and `+`, both sides of `?:` and `||` (the left side of `&&`
is only written when falsy), `String.raw`, in-file `const` bindings that build markup, `let`
accumulators (`html += row`, `html = html + row`, in loops and callbacks too), `[...].join(sep)`
and `list.map(fn).join(sep)`, and in-file helpers that return markup, with their parameters bound
to the call's arguments.

```ts bad
export function report(res, rows) {
  let html = '<ul>';
  for (const row of rows) {
    html += '<li>' + row.title + '</li>';
  }
  res.send(html + '</ul>');
}
```

```ts bad
export async function profile(res) {
  const row = await db.query('SELECT name FROM users WHERE id = $1', [1]);
  const page = `<h1>${row.name}</h1>`;
  res.send(page);
}
```

nunjucks `renderString(template, context)` and `ejs.render(template, data)` with a literal
template, inline or in a `const`, and a literal context object: each output (`{{ user.bio }}`,
`<%= bio %>`, `<%- locals.bio %>`) is looked up in the object, through nested literals. A raw
output (`| safe`, also after other filters; inside `{% autoescape false %}`; any output once the
file configures nunjucks with `autoescape` other than `true`; EJS `<%-`) is reported when its value
is not safe where it lands. An escaped output is reported only where escaping is not enough
(`<a href="{{ url }}">`, `<script>var u = <%= name %></script>`).

```ts bad
import nunjucks from 'nunjucks';

export function bio(req) {
  return nunjucks.renderString('<div>{{ bio | safe }}</div>', { bio: req.body.bio });
}
```

```ts good
import nunjucks from 'nunjucks';

export function bio(req) {
  return nunjucks.renderString('<div>{{ bio }}</div>', { bio: req.body.bio });
}
```

### Where a value lands

The author text before each runtime part decides where it lands, read the way a browser tokenizes
HTML (tags, attributes and their quoting, comments, and the elements whose content is not markup).

| Where | Safe there |
| --- | --- |
| Element text, `<textarea>`, `<title>`, a comment | an escaper, a sanitizer (element text only), `encodeURIComponent`, a guard that refuses `<` and `&` |
| A double-quoted attribute | an escaper, `encodeURIComponent`, a guard that refuses `<>&"'` and backtick |
| A single-quoted attribute | an escaper that also encodes `'` (escape-html, he, lodash `escape`, html-escaper, entities, a `.replace` chain covering `'`), a guard as above |
| An unquoted attribute | `encodeURIComponent`, the global `escape`, a guard that refuses whitespace, quotes and `<>&` |
| The start of a URL attribute (`href`, `src`, `action`, `formaction`, ...) before the author text fixes a scheme | `encodeURIComponent` (no `:` survives), a guard that also refuses `/`, `\` and `:` |
| A tag or attribute name, `<script>`, `<style>`, an event handler (`on*`), a `style` or `srcdoc` attribute, a URL after `javascript:` or after a scheme built from a runtime part | only a constant, a number, or a literal allowlist; in `<script>` code, also serialize-javascript and htmlescape output |
| Inside a `'`, `"` or backtick string, or a comment, in a `<script>` | only a constant, a number, or a literal allowlist |

A number (`Number()`, `parseInt`, `Math.*`, `.toFixed()`, arithmetic, `Date.now()`,
`new Date().toISOString()`), a boolean, a literal, an in-file `const` literal and a value bound by
`for (const x of LIST)` over a literal array nothing changes are safe anywhere. `.length` and
`.size` count as numbers unless read from request input (`req.query.q.length` can be a string sent
as `q[length]=...`).

`JSON.stringify` inside a `<script>` is reported: a value of `</script><script>alert(1)//` closes
the element. Use serialize-javascript or htmlescape there, as a JS expression, not inside a string:
`var state = ${serialize(data)};` is safe, while `JSON.parse('${serialize(data)}')`,
`"${serialize(data)}"` and a template literal are reported, because neither library escapes `'` or
backticks and their own `"` closes a double-quoted string. The rule reads the script text before
the value to tell: a quote escaped with `\` does not open or close a string, and a quote inside a
regex literal (`/'/g`, `/[a-z']/`) opens nothing. A `/` starts a regex at the start, after an
operator or punctuation (`( , = : [ ! & | ? { ; + - * % < > ~ ^`), after a reserved word
(`return`, `typeof`, `instanceof`, `in`, `new`, `delete`, `void`, `throw`, `case`, `do`, `else`),
and after the `)` of an `if`, `while`, `for` or `with` head. After any other `)`, a `]`, a name, a
number or a string it is division. Whitespace ends a word (`q` then a newline then `return` is two
words), and a name right after `.` is never a keyword (`a.return / 2`, `a.if(x)`). Where the rule
cannot tell, a `/` that does not start a comment makes it stop treating anything later in that
script as code, so it reports: after `}` (a block, or an object or function expression), `++`,
`--`, `.`, or a word that is a keyword only in some places (`of`, `await`, `yield`, `get`, `set`,
`async`, `let`, `static`). A value inside a regex body (`/${q}/i`) is never code.

### What makes a value safe

- **An escaper or sanitizer recognized by its import.** `he` (`encode`, `escape`), `entities`,
  `escape-html`, `html-escaper`, `escape-goat`, `lodash` / `lodash-es` / `underscore` /
  `lodash.escape` (`escape`), `validator` (`escape`), `xss`, `sanitize-html`, `dompurify`
  (`DOMPurify.sanitize`, and instances made with `DOMPurify(window)`), `isomorphic-dompurify`,
  `react-dom/server` (`renderToString`, `renderToStaticMarkup`), `serialize-javascript` and
  `htmlescape`, through `import` (default, named or namespace) or `require` (whole, destructured or
  `.name`), under any local name. A bare name alone proves nothing: `mysql.escape`,
  `conn.escape`, `mongoSanitize.sanitize` and an unbound `xss(x)` are reported. The global
  `encodeURIComponent` and `escape` count when nothing shadows them. The outermost call decides:
  `DOMPurify.sanitize(marked.parse(x))` is safe, `marked.parse(DOMPurify.sanitize(x))` is not.
- **Options that keep the protection on.** sanitize-html with `allowedTags: false`,
  `allowedAttributes: false`, `allowVulnerableTags`, a `script`, `style`, `textarea`, `option`,
  `svg` or similar tag, an `on*` or `srcdoc` attribute, a `javascript:` scheme, `transformTags` or
  `textFilter`; DOMPurify with `RETURN_DOM`, `RETURN_DOM_FRAGMENT`, `RETURN_DOM_IMPORT`,
  `IN_PLACE`, `ALLOW_UNKNOWN_PROTOCOLS`, `SAFE_FOR_XML: false`, `ALLOWED_URI_REGEXP`,
  `CUSTOM_ELEMENT_HANDLING`, a `script`, `iframe` or similar tag in `ADD_TAGS` / `ALLOWED_TAGS`, or
  an `on*` attribute in `ADD_ATTR` / `ALLOWED_ATTR` (also through `setConfig`); xss with
  `onTag`, `onTagAttr`, `onIgnoreTag`, `onIgnoreTagAttr`, `safeAttrValue`, `escapeHtml` or a
  dangerous tag in `whiteList`; he with `allowUnsafeSymbols`; serialize-javascript with `unsafe`:
  each of these counts as no sanitizer. Options must be an object literal, inline or in a `const`
  that is not exported and is only handed to sanitizer calls; anything else (a spread, a shared
  config from another file) counts as unknown, so as unsafe.
- **A configured escaper** in `sanitizers`, trusted to encode `&`, `<`, `>` and `"`: element text
  and double-quoted attributes. The name is trusted only for a helper the rule cannot read: one
  imported from another file, or not declared in this file. A function declared in this file is
  judged by its body alone, with the same proof as inline code, whether or not its name is in
  `sanitizers`: a `function escapeHtml(s) { return s.replace('<', '&lt;'); }` is reported, and one
  whose `.replace` chain also covers `'` is safe in single-quoted attributes too. Any other local
  binding (a parameter, a reassigned function, a value built at run time) proves nothing.
- **A `.replace` / `.replaceAll` chain** that encodes at least `&`, `<`, `>` and `"`. A step counts
  for a character only when it is global (`replaceAll`, or a regex with `g` and no `y`), its
  pattern consumes every occurrence of the character (`/</g`, `/[&<>"]/g`, `/&|</g`, not
  `/^</g` or `/[<]*/g`), and it writes text with no markup character: an entity, nothing, a lookup
  in a literal table that covers the character (`c => MAP[c]`, the table never changed), or
  `'&#' + c.charCodeAt(0) + ';'`. `q.replace('&', '&amp;')` only replaces the first `&`, and
  `q.replace(/[&<>"]/g, (c) => c)` and `'$&'` put the match back, so neither counts. A later step
  that writes a markup character (`.replace(/&lt;/g, '<')`) undoes the chain; `<br>` written for a
  newline keeps it, in element text and quoted attributes.
- **A guard** before the response, in the same function, with an `if` that exits (or an `if`
  around it): an allowlist (`includes` / `has` on in-file literals, `===` against literals) or a
  regex anchored at both ends, without the `m` flag or a `.`, that admits none of the characters the
  place needs refused (see the table). With the `u` flag, letter and number classes (`\p{L}`,
  `\p{N}`) are read as admitting no markup.

```ts good
export function list(req, res) {
  const sort = String(req.query.sort);
  if (!['asc', 'desc'].includes(sort)) return res.status(400).json({ error: 'sort' });
  res.send(`<p>Sorted ${sort}</p><script>window.sort = '${sort}';</script>`);
}
```

## What it does not flag

`res.json` / `res.jsonp`, a body that is not built with markup in this file (`res.send(data)`, an
object, a Buffer), and a write after a literal non-HTML content type set on every path to it: an
unconditional statement before the write in an enclosing block, or a call in the write's own chain
(`res.type('text/plain')`, `res.type('text').send(x)`, `res.set('Content-Type',
'application/json')`, `res.writeHead(200, { 'Content-Type': 'text/plain' })`, `ctx.type =
'text/plain'`). A type set in one branch only, inside a `try`, or in a callback does not count, and
any HTML, XML or SVG type (or one the rule cannot read) set before the write keeps it reported.

```ts good
export function note(req, res) {
  res.type('text/plain');
  res.send('<p>' + req.query.note + '</p>');
}
```

Not read: a template string built at run time, a context object that is not a literal (or has a
spread), a template loaded from a file (`res.render('page', ...)`), engines other than nunjucks and
EJS, a nunjucks output that is a function call or a literal, HTML written over several
`res.write` calls (each is judged alone), HTML built in one function and sent from another unless
through a helper that returns it, helpers with more than declarations and one `return`,
`DOMPurify.addHook`, and whether a URL in `<script src>` or `<iframe src>` points at another host
(a fixed scheme is all the rule checks there). `.replace` is taken to be the string method,
without type information.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `responseObjects` | `string[]` | `['res', 'response']` | Receivers whose `send`, `end` and `write` write an HTML-capable response body. Setting this replaces the defaults. |
| `replyObjects` | `string[]` | `['reply']` | Receivers whose `send` sends a string as text unless an HTML content type is set on them (Fastify). Setting this replaces the defaults. |
| `contextObjects` | `string[]` | `['ctx']` | Receivers whose `body` assignment is the response (Koa). Setting this replaces the defaults. |
| `sanitizers` | `string[]` | `['escapeHtml', 'escapeHTML', 'htmlEscape', 'encodeHTML']` | Escapers trusted to encode `&`, `<`, `>` and `"`, for helpers imported from another file or not declared in this one; a function declared in this file is judged by its body instead. An entry with a dot (`utils.escapeHtml`) matches that callee; one without matches a call by that bare name, never a method. Setting this replaces the defaults. |

Escaping modules count by their import whatever `sanitizers` says (see above).

```js
'noctcore-security/no-unescaped-html-response': [
  'error',
  { responseObjects: ['res'], sanitizers: ['escapeHtml', 'utils.escapeHtml'] },
]
```

## When not to use it

A JSON API that never builds HTML gains nothing from it. A server that renders HTML through a
templating engine with files on disk is better served by keeping autoescape on and reviewing raw
markers in the templates themselves.

## Related

- `require-sanitized-html`: the browser sinks (`dangerouslySetInnerHTML`, `innerHTML`,
  `insertAdjacentHTML`).
