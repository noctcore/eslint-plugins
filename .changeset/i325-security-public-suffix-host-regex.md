---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` and `no-user-controlled-fetch-url` no longer count a host regex that ends in a common public suffix as an allowlist. Anyone can register a name under `vercel.app`, `github.io`, `netlify.app`, `pages.dev`, `co.uk` and similar suffixes, so `/^[a-z0-9-]+\.vercel\.app$/.test(new URL(next).hostname)` lets `evil.vercel.app` through. Such a regex now counts only with one more literal label before the suffix (`^[a-z0-9-]+\.myapp\.vercel\.app$`). The suffixes come from a short built-in list. A project spreading `recommended` can see new errors where a preview-deploy allowlist matches any name under a shared hosting domain.

