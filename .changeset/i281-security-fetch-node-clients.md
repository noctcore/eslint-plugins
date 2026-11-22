---
'@noctcore/eslint-plugin-security': minor
---

`no-user-controlled-fetch-url` checks more HTTP clients by default: `axios(config)`, `axios(url, config)`, `axios.request(config)` (the URL is the config's `url`) and Node's `http.get`, `http.request`, `https.get` and `https.request` (an options object without `href` must name a fixed `host` / `hostname`). A config or options object held in an in-file `const` is read like an inline one. A new `socketCallees` option (default `net.connect`, `net.createConnection`, `tls.connect`) reports a socket opened to a runtime host, with the new message id `userControlledSocketHost`.

It also stops reporting a host-pinned URL: one whose `new URL(url).hostname` (or `.host` / `.origin`) was checked by an exiting `if`, or an `if` around the call, against `includes` / `has` / `===` on literals or an anchored regex whose every alternative ends in a literal domain, with no write to the URL after the read. `new URL(pinned).hostname` passed as a socket host counts as pinned.

A project spreading `recommended` can see new errors on `http` / `https` / `axios(config)` calls and sockets with a runtime target; each is an SSRF sink unless the host is checked as above. A project that set `fetchCallees` keeps its own list (the new client defaults do not apply) but gets the socket check.
