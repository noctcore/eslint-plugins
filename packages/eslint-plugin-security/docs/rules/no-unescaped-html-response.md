# `noctcore-security/no-unescaped-html-response`

> HTML built from a runtime value and sent with `res.send` / `res.end` / `res.write`, or bound to a raw template variable, must escape or sanitize the value.

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

Template engines escape by default, which is why a value that skips escaping is marked by hand
(`{{ bio | safe }}` in nunjucks, `<%- bio %>` in EJS). That marker is where reflected and stored XSS
come back.

The rule judges the HTML being built, not where each value came from, the way
`no-shell-interpolation` judges a command string: a value read from the database (stored XSS)
counts the same as one read from the request.

## What it flags

- `res.send(x)`, `res.end(x)` and `res.write(x)` on a receiver in `responseObjects` (`res`,
  `response`), also after calls that return the response (`res.status(200).send(x)`), where `x`,
  followed through in-file `const` bindings, is a template or `+` concatenation whose
  author-written text contains a tag (`<` followed by a letter, `/` or `!`), and one of its runtime
  parts is not proven safe (see below). The report is on that part.

```ts bad
export async function profile(res) {
  const row = await db.query('SELECT name FROM users WHERE id = $1', [1]);
  const page = `<h1>${row.name}</h1>`;
  res.send(page);
}
```

- `renderString(template, context)` (nunjucks, on the module or an environment) and
  `ejs.render(template, data)` with a literal template, inline or in a `const`, that marks a key raw
  (`{{ key | safe }}`, with other filters before `safe` too, or `<%- key %>`), when the context
  object literal binds that key to a value that is not proven safe.

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

## What it does not flag

A runtime part is proven safe when it is:

- a literal or an in-file `const` literal;
- a number: `Number()`, `parseInt`, `parseFloat`, `Math.*`, `.length`, `.size`, `.toFixed()`,
  arithmetic, or a comparison;
- the result of an escaper or sanitizer in `sanitizers`, with the outermost call deciding:
  `DOMPurify.sanitize(marked.parse(x))` is safe, `marked.parse(DOMPurify.sanitize(x))` is not;
- a `.replace` / `.replaceAll` chain that encodes at least `&`, `<`, `>` and `"`;
- a value the function checked before the response with an `if` that exits (or an `if` around
  it): an allowlist (`includes` / `has` on in-file literals, `===` against literals) or a regex
  anchored at both ends, without the `m` flag or a `.`, that admits none of `<`, `>`, `&`, `"`, `'`
  or a backtick.

```ts good
export function list(req, res) {
  const sort = String(req.query.sort);
  if (!['asc', 'desc'].includes(sort)) return res.status(400).json({ error: 'sort' });
  res.send(`<p>Sorted ${sort}</p>`);
}
```

It never looks at `res.json` / `res.jsonp`, at a body that is not an HTML-shaped template or
concatenation (`res.send(data)`, an object, a Buffer), or at a write in a function that first sets
a literal non-HTML content type on the response (`res.type('text/plain')`,
`res.set('Content-Type', 'application/json')`).

A template string built at run time, a context object that is not a literal, a template loaded
from a file (`res.render('page', ...)`) and engines other than nunjucks and EJS are not read. HTML
built in one function and sent from another is not followed.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `responseObjects` | `string[]` | `['res', 'response']` | Receivers whose `send`, `end` and `write` write the response body. Setting this replaces the defaults. |
| `sanitizers` | `string[]` | see below | Functions whose result is safe in HTML. An entry with a dot (`he.encode`) matches that callee; one without (`escapeHtml`) matches a bare call or any method of that name. Setting this replaces the defaults. |

Default `sanitizers`: `escapeHtml`, `escapeHTML`, `htmlEscape`, `encodeHTML`, `escape`, `he.encode`,
`he.escape`, `sanitize` (so `DOMPurify.sanitize`), `sanitizeHtml`, `xss`, `filterXSS`.

```js
'noctcore-security/no-unescaped-html-response': [
  'error',
  { responseObjects: ['res', 'reply'], sanitizers: ['escapeHtml', 'he.encode', 'renderSafe'] },
]
```

## When not to use it

A JSON API that never builds HTML gains nothing from it. A server that renders HTML through a
templating engine with files on disk is better served by keeping autoescape on and reviewing raw
markers in the templates themselves.

## Related

- `require-sanitized-html`: the browser sinks (`dangerouslySetInnerHTML`, `innerHTML`,
  `insertAdjacentHTML`).
