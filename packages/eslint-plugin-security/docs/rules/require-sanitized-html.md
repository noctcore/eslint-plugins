# `noctcore-security/require-sanitized-html`

> HTML reaching `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` or `insertAdjacentHTML` must be static markup or pass through a sanitizer. Opt-in.

## Why

React escapes everything it renders except the one prop named for the danger, and the DOM parses
whatever is assigned to `innerHTML`. Those are the places where a stored comment or a reflected
query parameter becomes a `<img onerror>` that runs in your users' sessions:

```tsx bad
export function Comment({ comment }: { comment: { body: string } }) {
  // a comment body of `<img src=x onerror=alert(1)>` runs as script
  return <div dangerouslySetInnerHTML={{ __html: comment.body }} />;
}
```

```tsx good
import DOMPurify from 'dompurify';

export function Comment({ comment }: { comment: { body: string } }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.body) }} />;
}
```

`react/no-danger` bans the prop outright, so a codebase that genuinely needs it turns that rule off
and loses the check everywhere. `eslint-plugin-no-unsanitized` covers the DOM sinks but not React.
This rule allows the sink and asks for proof that what reaches it is safe.

## What it flags

The sinks:

- JSX `dangerouslySetInnerHTML={{ __html: X }}`, including a `const` object literal passed as the
  prop value. A markup object the rule cannot see into (`dangerouslySetInnerHTML={props.markup}`,
  or one built with a spread) is reported as a whole.
- `el.innerHTML = X`, `el.outerHTML = X`, and their `+=` forms.
- `el.insertAdjacentHTML(position, X)`.

`X` passes when the rule can see that it is safe:

- author-written markup: a string literal, or a template or `+` concatenation whose every part
  passes;
- a `?:`, `||` or `??` whose branches all pass, and `cond && X` when `X` passes (the falsy left
  side of `&&` never renders as markup);
- a `const` declared in the same file whose initializer passes;
- a call to a sanitizer in `sanitizers`, or an expression named in `trustedSources`.

Everything else is reported, because nothing else is proof.

```ts bad
// one dynamic part is enough
list.innerHTML += `<li>${item.title}</li>`;
```

```ts good
import DOMPurify from 'dompurify';

list.innerHTML += `<li>${DOMPurify.sanitize(item.title)}</li>`;
```

Static markup needs nothing:

```tsx good
const ICON = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>';

export function Icon() {
  return <i dangerouslySetInnerHTML={{ __html: ICON }} />;
}
```

`textContent`, `innerText` and `insertAdjacentText` are not HTML sinks and are never reported;
they are usually the better fix when the value was never meant to be markup.

There is no autofix: which sanitizer, and with which configuration, is the author's call.

## Why it is opt-in

A real codebase has HTML it trusts that no syntactic rule can prove safe: a syntax highlighter's
output, Markdown compiled at build time from files in the repo, a JSON-LD `<script>`. Staying quiet
on those takes a per-project list, and a rule that needs one does not belong in a shared preset.
Enable it and name your producers:

```tsx bad options={"trustedSources":["highlighter.codeToHtml()"]}
// `marked` renders Markdown; it does not sanitize it
export function Post({ md }: { md: string }) {
  return <article dangerouslySetInnerHTML={{ __html: marked(md) }} />;
}
```

```tsx good options={"trustedSources":["highlighter.codeToHtml()"]}
export function Code({ code }: { code: string }) {
  return <pre dangerouslySetInnerHTML={{ __html: highlighter.codeToHtml(code, { lang: 'ts' }) }} />;
}
```

A JSON-LD block is only safe when `<` is escaped, since a `</script>` inside the data ends the
element. Put the escaping in a function and trust that function, not `JSON.stringify` itself.

## Options

```ts prose reason="the options type, not a lint example"
type Options = {
  /**
   * Functions (callee source text) whose result is sanitized HTML, with or without a
   * trailing `()`. Replaces the default when set, so `[]` accepts no sanitizer at all.
   * Default: ['DOMPurify.sanitize', 'sanitize', 'sanitizeHtml', 'xss', 'filterXSS'].
   */
  sanitizers?: string[];
  /**
   * Expressions (source text) that hold trusted HTML the rule cannot see into:
   * `post.contentHtml`. An entry ending in `()` matches any call to that callee,
   * whatever its arguments: `highlighter.codeToHtml()`, `renderMarkdown()`.
   * Default: [].
   */
  trustedSources?: string[];
};
```

The default sanitizers are DOMPurify (`DOMPurify.sanitize`, and `sanitize`, the named export of
`isomorphic-dompurify`), `sanitize-html` under its documented import name `sanitizeHtml`, and
`xss` / `filterXSS` from js-xss. A sanitizer is matched by the callee's source text, so an import
under another name (`import purify from 'dompurify'`) needs its own entry: `'purify.sanitize'`.
A project function that happens to be called `sanitize` but does something else would pass
unchecked; if you have one, set `sanitizers` explicitly.

## When not to use it

If your HTML comes only from sources you control and the list of them keeps growing, the rule is
more friction than protection. It earns its place where user-supplied or third-party content can
reach one of these sinks.
