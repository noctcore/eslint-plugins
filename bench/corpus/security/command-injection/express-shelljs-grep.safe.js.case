// @bench category=command-injection cwe=CWE-78 framework=express pair=express-shelljs-grep title="search term escaped with shell-quote before shelljs exec"
// ok
const express = require('express');
const shell = require('shelljs');
const { quote } = require('shell-quote');

const app = express();

app.get('/search', (req, res) => {
  const term = String(req.query.term || '');
  const cmd = `grep -rn ${quote([term])} /srv/acme/docs`;
  const result = shell.exec(cmd, { silent: true });
  if (result.code > 1) {
    return res.status(500).json({ error: 'search failed' });
  }
  const matches = result.stdout.split('\n').filter(Boolean);
  res.json({ count: matches.length, matches });
});

app.listen(3000);
