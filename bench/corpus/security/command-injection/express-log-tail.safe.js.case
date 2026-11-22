// @bench category=command-injection cwe=CWE-78 framework=express pair=express-log-tail title="line count parsed and range checked before interpolating into tail"
// ok
const cp = require('node:child_process');
const express = require('express');

const router = express.Router();

router.get('/logs/tail', (req, res) => {
  const lines = parseInt(String(req.query.lines || '100'), 10);
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000) {
    return res.status(400).send('lines must be between 1 and 1000');
  }
  cp.exec(`tail -n ${lines} /var/log/acme/app.log`, (error, stdout) => {
    if (error) {
      return res.status(500).send('could not read log');
    }
    res.type('text/plain').send(stdout);
  });
});

module.exports = router;
