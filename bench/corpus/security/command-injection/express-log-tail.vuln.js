// @bench category=command-injection cwe=CWE-78 framework=express pair=express-log-tail title="line count from the query interpolated into tail via a namespace import"
const cp = require('node:child_process');
const express = require('express');

const router = express.Router();

router.get('/logs/tail', (req, res) => {
  const lines = req.query.lines || '100';
  cp.exec(`tail -n ${lines} /var/log/acme/app.log`, (error, stdout) => { // expect: security/no-shell-interpolation
    if (error) {
      return res.status(500).send('could not read log');
    }
    res.type('text/plain').send(stdout);
  });
});

module.exports = router;
