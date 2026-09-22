---
'@noctcore/eslint-utils': patch
---

`makeCreateRule` now points every rule's `meta.docs.url` at its rendered page on the docs site,
`https://noctcore.github.io/eslint-plugins/rules/<plugin>/<rule>/`, instead of the raw Markdown
file on GitHub. Plugins import `makeCreateRule` at runtime (it is not bundled into their `dist`),
so consumers pick up the new links as soon as this version resolves in their install; the plugins
themselves do not need a rebuild or a republish.
