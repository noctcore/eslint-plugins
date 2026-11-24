---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reads the args array of `spawn` / `spawnSync` / `execFile` / `execFileSync` when the options pass a `shell` value other than `false`. Node joins the program and the args with spaces into the command string the shell reads, so `spawn('ls', [req.query.dir], { shell: true })` (`dir = '; rm -rf ~'`) is now reported. Each element of an inline array is checked like an interpolated part, where it lands: `spawn('sudo', [tool], { shell: true })` needs `tool` proven as a program name, and `spawn('ls', [';', t], { shell: true })` runs `t` as one. An args value that is not an inline array (a binding, a call, a spread) is reported. Static args (`spawn('npm', ['install'], { shell: true })`) and the forms without a shell stay unreported.
