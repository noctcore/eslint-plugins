---
'@noctcore/eslint-plugin-security': patch
---

The security rules now judge a value the same way when the code only moves it around inside one file. A value handed through an identity helper (`forward(x)`), an object or array literal (`{ value: x }.value`, `[x][0]`), a destructuring of a literal, a spread of an array literal (`fetch(...[url])`), `await Promise.resolve(x)`, `Promise.resolve(x).then((v) => ...)`, a callback run in place (`[x].forEach((v) => ...)`), a `let` written once, or `x as string` / `x!` keeps both what makes it dangerous and the checks that made it safe. The moves are followed up to eight steps, only through code in the same file. A check that makes a value safe is carried across a move only when the rule can show nothing changed the value on the way: an object or array is trusted only as a `const` literal that is not exported, holds plain data (no methods, getters or setters), and is only read by fixed keys; a `let` only when its one write surely runs before the read; a callback value only for a callback with one parameter that is not `async`.

This closes false alarms on checked values and finds missed cases:

- `no-shell-interpolation` sees a runner imported under another name (`import { execSync as run }`) and a command built with `'cmd '.concat(x)`, and keeps an allowlist check on a value that was moved before the call.
- `no-user-controlled-redirect` finds the response of a route handler by its place (`app.get(path, (a, b) => b.redirect(...))`, a Nest `@Res()` parameter, an `http.createServer` handler), not only by the name `res`, and reads the target through a spread argument and through a guard boolean that was moved.
- `no-user-controlled-fetch-url` sees `axios` or `node:https` imported under another name, the default export of `node-fetch` under any name, and a URL passed as `...[url]`, and keeps a host check across the moves above.
- `require-path-containment` finds the request of a route handler by its place, follows a request value into a callback run in place, and keeps an allowlist check across the moves above. A Koa `(ctx, next)` handler is not mistaken for `(req, res)`.
- `auth-cookie-flags` reads the value passed as `...[value]` and the flags of an options object spread in from an object literal or a `const` holding one.
- `no-unescaped-html-response` keeps an encoder's result safe across the moves above, including `he.encode(...[x])`, and reads `'<p>'.concat(...)` like `+`.
- `require-sanitized-html` sees DOMPurify or sanitize-html imported under another name, reads `'<b>'.concat(...)` like `+`, and follows a `{ __html }` object written once inside a callback.

Some code that was quiet before is now reported, where the moved value really is unchecked.
