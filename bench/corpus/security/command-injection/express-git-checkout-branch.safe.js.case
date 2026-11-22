// @bench category=command-injection cwe=CWE-78 framework=express pair=express-git-checkout-branch title="branch validated with an anchored regex before the exec call"
// ok
const { exec } = require('node:child_process');
const express = require('express');

const router = express.Router();

router.post('/deploy/checkout', (req, res) => {
  const branch = String(req.query.branch || '');
  const repoDir = '/srv/acme/app';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(branch)) {
    return res.status(400).json({ error: 'invalid branch' });
  }
  exec(`git -C ${repoDir} checkout ${branch}`, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: 'checkout failed' });
    }
    res.json({ output: stdout.trim() });
  });
});

module.exports = router;
