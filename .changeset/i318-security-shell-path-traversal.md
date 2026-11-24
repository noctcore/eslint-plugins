---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reads a value glued right after a `/` (`` `rm -rf /srv/${x}` ``) as a path segment more strictly. Its guard regex must refuse `/` as well as `''`, `.` and `..`, and may admit `/` only when it admits no `.` and cannot start with `/`: `/^[a-z./]+[a-z]$/` (`x = '../../etc'`) and `/^[a-z]+(\/\.\.)?$/` (`x = 'a/..'`) no longer count, and neither does `/^[a-z/]+$/` (`x = '/'` removes `/srv`). The segment is also read through quotes (`` `/srv/"${x}"` ``, `` `'/srv/'${x}` ``), and a value glued right after another value (`/srv/${a}${b}`) must pass both as a path segment and as the start of a word.
