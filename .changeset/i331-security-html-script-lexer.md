---
'@noctcore/eslint-plugin-security': patch
---

`no-unescaped-html-response` reads more of what decides a value's place in a script. In-file `const` text with no tag in it is now read as author text, so a quote in `const OPEN = "JSON.parse('"` opens a string before a serialized value. The script lexer ends a word at a comment (`1// n` then `typeof /'/`), reads a spread `...` as an operator and the dot of `1.` as part of the number, never takes a private name (`this.#in`) or a name with a `\u` escape for a keyword, reads every identifier character (combining marks, ZWNJ, `·`), and knows `default` and `extends` as words a regex may follow. The HTML escape states of a script are followed: after `<!--<script>`, a `</script>` no longer ends the element.

A dotted `sanitizers` entry (`utils.escapeHtml`) is now trusted by the binding it starts from, as bare entries are: only when imported, `require`d or not declared in the file. An object, class or parameter of the file proves nothing. A helper that returns a parameter it also writes no longer counts as returning the argument.

Report removed: a `<script>` whose first `type` attribute is a literal non-script type (`application/json`, `text/template`) is a data block the browser never runs. Its content is judged like `<textarea>` content, so serialize-javascript output inside a quote there, and escaper output in markup there (``<script type="text/x-template"><p>${escapeHtml(q)}</p></script>``), are no longer reported; JSON.stringify output, which can write `</script>`, still is.
