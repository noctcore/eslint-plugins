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
followed by a letter, `/` or `!`) or a React server render (`renderToString`,
`renderToStaticMarkup`), and a runtime part that is not safe where it lands (see below).
The report is on that part. The bodies it reads:

- `res.send(x)`, `res.end(x)` and `res.write(x)` on a receiver in `responseObjects` (`res`,
  `response`), also after calls that return the response (`res.status(200).send(x)`);
- `reply.send(x)` on a receiver in `replyObjects` (`reply`) once an HTML content type is set on it:
  Fastify sends a string as text otherwise. The same goes for the return value of an async handler
  that takes the reply as a parameter (`async (request, reply) => { reply.type('text/html'); return
  html; }`);
- `ctx.body = x` and `ctx.response.body = x` on a receiver in `contextObjects` (`ctx`), unless no
  content type is set and the body starts with author text that is not `<` on every branch of a
  `?:`, `||` or `??`: Koa sends that as text;
- `new Response(x, init)` and `new NextResponse(x, init)` (from `next/server`) whose `init` sets an
  HTML content type, as in a Next route handler: a literal, or a `const` headers object or
  `Headers` instance (with its `.set` / `.append` calls);
- the return value of a Nest route handler (`@Get`, `@Post`, ... from `@nestjs/common`, also
  `@common.Get()` on a namespace import): the Express platform sends a returned string as `text/html`. A `@Header('Content-Type', ...)` with a
  type that is not HTML, `@Render`, `@Redirect`, `@Sse` or a `@Res()` / `@Next()` parameter
  leaves it alone. The Fastify platform sends a string as text, but the rule cannot tell the
  platform from the handler, so it reports there too.

The body is followed through templates and `+`, both sides of `?:` and `||` (the left side of `&&`
is only written when falsy), `String.raw`, in-file `const` bindings that build markup or hold
constant text (read as author text, so a quote in `const OPEN = "JSON.parse('"` opens a string in a
script), `let` accumulators (`html += row`, `html = html + row`, in loops and callbacks too),
array accumulators (`rows.push(row)` then `rows.join('')`), `[...].join(sep)` and
`list.map(fn).join(sep)` (every `return` of the mapper), `.concat`, a constant template filled by
`.replace` / `.replaceAll` at a string or plain regex placeholder (`tpl.replace('{{name}}', q)`),
and in-file helpers that return markup (every `return`), with their parameters bound to the call's
arguments unless the helper writes them.

A placeholder is read with the value in place only when `.replace` writes the value as it is: a
replacer function of this file, a constant without `$`, a number or `encodeURIComponent` output. A
replacement string applies `$` patterns (`` $` ``, `$'` and `$&` copy author text into the value's
place), and escape-html leaves `$` alone, so any other replacement may land anywhere and must be
safe in a tag. A value an earlier `.replace` wrote may hold a later placeholder, so the later
replacement is judged there too.

Any other call or template tag given markup (``layout(`<h1>${q}</h1>`)``, `dedent`, the common-tags
`html` tag, a decoder, or a string method that cuts, pads or rewrites it: `.slice`, `.padStart`,
`.split`, `.trim`, a `.replace` that is not a placeholder fill) is opaque: the rule cannot tell that
it keeps the escaped text escaped and in place. The markup it is given is still read where the call
stands, so an unsafe value in it is reported; every other value it is given may land anywhere and
must be safe in a tag; and the call itself is reported where it lands when nothing inside it is. A
string method called on markup returns markup, so it counts with no author tag around it. An
escaping module (common-tags `safeHtml` included) is judged as a value.

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
`<%= bio %>`, `<%- locals.bio %>`, `<%- locals["bio"] %>`, a nunjucks `{% set b = bio | safe %}`
alias) is looked up in the object, through nested literals. A raw
output (`| safe`, also after other filters; inside `{% autoescape false %}`; any output once the
file configures nunjucks with `autoescape` other than `true`; EJS `<%-`, and `<%=` too when the
options replace `escape` or `escapeFunction`) is reported when its value is not safe where it
lands. EJS options are read from a literal third argument (or a `const` holding one), and from the
data object when there is none, as EJS does: `delimiter`, `openDelimiter`, `closeDelimiter`
and `localsName` change how the template is read. When the options cannot be read in full (not a
literal, a spread or computed key, in the data too when it holds the options, `outputFunctionName`, `client` or another option that changes the output), or
the file writes a setting on `ejs` (`ejs.escapeXML = ...`, `ejs.delimiter = ...`) or hands it to a
call, every value in the data object is judged as raw element text. An escaped output is reported
only where escaping is not enough (`<a href="{{ url }}">`, `<script>var u = <%= name %></script>`).

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
| Element text, `<textarea>`, `<title>`, a comment, a script data block | an escaper, a sanitizer (element text only), `encodeURIComponent`, a guard that refuses `<` and `&` |
| A double-quoted attribute | an escaper, `encodeURIComponent`, a guard that refuses `<>&"'` and backtick |
| A single-quoted attribute | an escaper that also encodes `'` (escape-html, he, lodash `escape`, html-escaper, entities, a `.replace` chain covering `'`), a guard as above |
| An unquoted attribute | `encodeURIComponent`, the global `escape`, a guard that refuses whitespace, quotes and `<>&` |
| The start of a URL attribute (`href`, `src`, `action`, `formaction`, ..., a meta refresh `content` after its delay, an SVG `animate` / `set` `to`, `from`, `by` or `values` item) before the author text fixes a scheme | `encodeURIComponent` (no `:` survives), a guard that also refuses `/`, `\` and `:` |
| A tag or attribute name, `<script>`, `<style>`, an event handler (`on*`), a `style` or `srcdoc` attribute, a URL after `javascript:` or after a scheme built from a runtime part, a `data:` URL in an `iframe`, `frame` or `embed` `src` or an `object` `data` | only a constant, a number, or a literal allowlist; in `<script>` code, also serialize-javascript and htmlescape output |
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
(`return`, `typeof`, `instanceof`, `in`, `new`, `delete`, `void`, `throw`, `case`, `do`, `else`,
`default`, `extends`), after a spread `...`, and after the `)` of an `if`, `while`, `for` or
`with` head. After any other `)`, a `]`, a name, a number (`1.` included) or a string it is
division. Whitespace and comments end a word (`q` then a newline then `return` is two words), a
name reads every identifier character (combining marks, ZWNJ, `·`), and a name right after `.`
or `#`, or written with a `\u` escape, is never a keyword (`a.return / 2`, `a.if(x)`,
`this.#in / 2`). Where the rule
cannot tell, a `/` that does not start a comment makes it stop treating anything later in that
script as code, so it reports: after `}` (a block, or an object or function expression), `++`,
`--`, `.`, or a word that is a keyword only in some places (`of`, `await`, `yield`, `get`, `set`,
`async`, `let`, `static`). A value inside a regex body (`/${q}/i`) is never code.

Author text is read as the browser reads it: a comment also ends at `<!-->`, `<!--->` and `--!>`,
and character references in a URL (`&#106;avascript:`, `javascript&colon;`) are decoded before
the scheme is read, with the leading spaces and the tabs and newlines the browser drops left out.
A URL start the rule cannot shorten below 256 characters that way (a long character reference, a
meta refresh head) counts as a script URL. A meta `content` holds a URL when an earlier `http-equiv` is `refresh` (or not
literal).

A `<script>` whose first `type` attribute is a literal JSON or plain text type
(`application/json`, `application/ld+json` and other `+json` types, `text/json`, `text/plain`) is a
data block no script runs: only its `</script>` matters, as in a `<textarea>`. Any other type stays
script, since the browser or a library may run it: a JavaScript type, `module`, `importmap`,
`speculationrules`, `text/babel`, `text/x-template` (Vue reads `{{ }}` in it), a type with
parameters (`text/javascript; charset=utf-8`), an empty type, a type with a runtime part and a type
written with a character reference (`text&#47;javascript`). The HTML escape states inside a script are followed: after
`<!--` then `<script>`, a `</script>` does not end the element until a `-->` comes first.

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
  `svg` or similar tag, an `on*` or `srcdoc` attribute (also through a glob such as `o*` or
  `s*`, which match `onerror` and `srcdoc`), a `javascript:` scheme, a `data:` scheme for a tag
  in `allowedSchemesByTag` other than `img`, `audio`, `video`, `source`, `image` and `track`, a
  `data:` scheme in `allowedSchemes` with `iframe` or `frame` allowed, `transformTags` or
  `textFilter`; DOMPurify with `RETURN_DOM`, `RETURN_DOM_FRAGMENT`, `RETURN_DOM_IMPORT`,
  `IN_PLACE`, `ALLOW_UNKNOWN_PROTOCOLS`, `SAFE_FOR_XML: false`, `ALLOWED_URI_REGEXP`,
  `CUSTOM_ELEMENT_HANDLING`, a `script`, `iframe` or similar tag in `ADD_TAGS` / `ALLOWED_TAGS`,
  an `on*` attribute in `ADD_ATTR` / `ALLOWED_ATTR`, a URL attribute (`href`, `src`, ...) in
  `ADD_URI_SAFE_ATTR`, a tag other than those media tags in `ADD_DATA_URI_TAGS`, a `NAMESPACE`
  other than XHTML or a `PARSER_MEDIA_TYPE` other than `text/html`; xss with `onTag`,
  `onTagAttr`, `onIgnoreTag`, `onIgnoreTagAttr`, `safeAttrValue`, `escapeHtml` or a dangerous
  tag in `whiteList`; he with `allowUnsafeSymbols`; serialize-javascript with `unsafe`: each of
  these counts as no sanitizer. Options must be an object literal, inline or in a `const` that is
  not exported and is only handed to sanitizer calls; anything else (a spread, a shared config from
  another file) counts as unknown, so as unsafe.
- **No shared config that switches protection off.** The default export of `dompurify` and
  `isomorphic-dompurify` is one instance: a `setConfig` on it (as `DOMPurify.setConfig`, through
  a `const` alias, or as the named `setConfig` export, also through `.call` or `.apply`) whose config fails the checks above, or
  cannot be read, makes every `sanitize` of that module untrusted in the file, the named
  `sanitize` export included. So does handing the module binding to a call, assigning it, or
  writing one of its members. An instance made with `DOMPurify(window)` keeps its own config. A
  write to `sanitizeHtml.defaults` or `xss.whiteList` (an assignment, a `push`, `Object.assign`,
  a `const` alias or object that is then changed, or the module handed to a call) makes every call
  of that module untrusted; reading them is fine when the value is copied (`.concat()`,
  `.slice()`, `.length`) or handed straight to the sanitizer.
- **React rendering without unsafe inner HTML.** `renderToString` and `renderToStaticMarkup`
  escape text, but write `dangerouslySetInnerHTML` as is. The rendered element is read, with every
  component, element and object it names in this file, and a `dangerouslySetInnerHTML` (JSX or a
  `createElement` props object) counts only when its `__html` is safe as element text (a
  constant, or sanitized). A component imported from another file or received as a parameter
  cannot be read, and counts as safe.
- **A configured escaper** in `sanitizers`, trusted to encode `&`, `<`, `>` and `"`: element text
  and double-quoted attributes. The name is trusted only for a helper the rule cannot read: one
  imported from another file, or not declared in this file. A function declared in this file is
  judged by its body alone, with the same proof as inline code, whether or not its name is in
  `sanitizers`: a `function escapeHtml(s) { return s.replace('<', '&lt;'); }` is reported, and one
  whose `.replace` chain also covers `'` is safe in single-quoted attributes too. Any other local
  binding (a parameter, a reassigned function, a value built at run time) proves nothing. A dotted
  entry (`utils.escapeHtml`) is trusted the same way, by the name it starts from: imported,
  `require`d or not declared in this file; an object, class or parameter of this file proves nothing.
  Either kind stops counting once the file writes it: a write to the name other than its
  declaration, to a member on the way to the callee (`utils.escapeHtml = ...`, `utils[k] = ...`),
  or `Object.assign` / `Object.defineProperty` on one of them. A reassigned `require` of an
  escaping module no longer counts as that module either.
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

Not read: what a call from elsewhere returns (it stays opaque), a meta `http-equiv` written after `content`, a nunjucks `{% set %}{% endset %}` block,
a template string built at run time, a context object that is not a literal (or has a
spread), a template loaded from a file (`res.render('page', ...)`), engines other than nunjucks and
EJS, a nunjucks output that is a function call or a literal, HTML written over several
`res.write` calls (each is judged alone), HTML built in one function and sent from another unless
through a helper that returns it (a parameter the helper writes no longer counts as the argument),
a helper that returns no markup and has more than declarations and one `return` (one that returns
markup is read at every `return`),
`DOMPurify.addHook`, a sanitizer config or default changed in another file, and whether a URL in `<script src>` or `<iframe src>` points at another host
(a fixed scheme is all the rule checks there). A method with a string method's name (`.replace`,
`.slice`, ...) is taken to be the string method, without type information.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `responseObjects` | `string[]` | `['res', 'response']` | Receivers whose `send`, `end` and `write` write an HTML-capable response body. Setting this replaces the defaults. |
| `replyObjects` | `string[]` | `['reply']` | Receivers whose `send` sends a string as text unless an HTML content type is set on them (Fastify). Setting this replaces the defaults. |
| `contextObjects` | `string[]` | `['ctx']` | Receivers whose `body` assignment is the response (Koa). Setting this replaces the defaults. |
| `sanitizers` | `string[]` | `['escapeHtml', 'escapeHTML', 'htmlEscape', 'encodeHTML']` | Escapers trusted to encode `&`, `<`, `>` and `"`, for helpers imported from another file or not declared in this one; a function declared in this file is judged by its body instead. An entry with a dot (`utils.escapeHtml`) matches that callee when the name it starts from is imported, `require`d or not declared in this file; one without matches a call by that bare name, never a method. Neither counts once the file writes the name, a member on the way to the callee, or one of them through `Object.assign` / `Object.defineProperty`. Setting this replaces the defaults. |

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
