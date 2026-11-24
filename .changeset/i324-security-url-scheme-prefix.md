---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` and `no-user-controlled-fetch-url` no longer count a relative prefix made only of scheme characters as a fixed origin. The runtime part after it can finish it into a scheme, so `` res.redirect(`h${x}`) `` (`x = 'ttps://evil.com'`) and `` fetch(`java${x}`) `` (`x = 'script:alert(1)'`) are now reported. A prefix that holds a `/`, `?` or `#` (`` `home/${x}` ``, `` `page.html?${x}` ``) still pins the origin.
