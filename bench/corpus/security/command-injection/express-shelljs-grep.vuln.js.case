// @bench category=command-injection cwe=CWE-78 framework=express pair=express-shelljs-grep title="search term from the query interpolated into shelljs exec"
const express = require('express');
const shell = require('shelljs');

const app = express();

app.get('/search', (req, res) => {
  const term = req.query.term;
  const result = shell.exec(`grep -rn ${term} /srv/acme/docs`, { silent: true }); // expect: security/no-shell-interpolation
  if (result.code > 1) {
    return res.status(500).json({ error: 'search failed' });
  }
  const matches = result.stdout.split('\n').filter(Boolean);
  res.json({ count: matches.length, matches });
});

app.listen(3000);
