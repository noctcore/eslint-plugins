---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-fetch-url` has two opt-in options, both off by default. `trustedSources` names values the person running the program picks, such as a CLI config or flag (`trustedSources: ['config']`): the expression and every property read off it count as a trusted origin and a fixed host. `allowLoopback: true` trusts a URL whose author-written text names `localhost`, `127.0.0.1` or `[::1]` followed by a port the rule can see is a number (`http://127.0.0.1:${Number(port)}/health`). A runtime value is never trusted for looking like loopback.
