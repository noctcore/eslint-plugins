---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reports three more shapes. A literal in a joi or zod chain that changes case is read as each case it can take, so after `Joi.string().valid('SUDO').lowercase()` the value may be the wrapper `sudo`. `spawn`, `spawnSync`, `execFile` and `execFileSync` with no `shell` option now read a shell program told to run a command: `spawn('sh', ['-c', cmd])` (also `bash -lc`, `/bin/sh -e -c`, `sh -o pipefail -c`, `cmd.exe /c`) checks the built command like `exec`. A word built from a proven value that can spell a `find` action (`find . -${x}`) or a package runner's subcommand (`npm ${x} ${t}`) is read as one, so the words after it run as a program.
