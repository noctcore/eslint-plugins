---
'@noctcore/eslint-plugin-react': patch
'@noctcore/eslint-plugin-security': patch
---

`prefer-lazy-state-init` now matches storage calls written with a global prefix.

`window.localStorage.getItem` and `localStorage.getItem` are one call written two ways, and the
rule compared the dotted path literally, so the default `localStorage.getItem` entry saw only the
bare form and every `window.`-prefixed call site went unreported. `window.`, `globalThis.` and
`self.` are now stripped before matching, and an explicitly configured prefixed path still matches
as written.

Also corrects the security plugin's README, which wired an example rule at `warn` against the
house policy that every rule is `error` or `off`.
