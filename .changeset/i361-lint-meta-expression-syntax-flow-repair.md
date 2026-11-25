---
'@noctcore/lint-meta-rules': patch
---

`github-actions-expression-syntax` no longer reports a valid workflow as not valid YAML when an under-indented flow collection holds a quoted value after an anchor or tag (`&a "x #y]"`, `!!str "x"`) or right after a `:` (`"os":"{ubuntu"`). The repair of such a collection read the `[`, `{` or ` #` inside the quote as structure, re-indented the rest of the file and hid any real expression error behind a false load failure. When a whole-collection repair still leaves the file unparsed, it is now read again one line at a time, so a repair alone never makes a valid file fail. A comment written right after a flow indicator (`[x,#c`) is now spaced at every site in one pass instead of one parse each.
