# @noctcore/eslint-utils

## 0.1.1

### Patch Changes

- [`3166c84`](https://github.com/noctcore/eslint-plugins/commit/3166c8468dcfa29e6c964aa3d0035461b2420e6a) Thanks [@Shironex](https://github.com/Shironex)! - `makeCreateRule` now points every rule's `meta.docs.url` at its rendered page on the docs site,
  `https://noctcore.github.io/eslint-plugins/rules/<plugin>/<rule>/`, instead of the raw Markdown
  file on GitHub. Plugins import `makeCreateRule` at runtime (it is not bundled into their `dist`),
  so consumers pick up the new links as soon as this version resolves in their install; the plugins
  themselves do not need a rebuild or a republish.
