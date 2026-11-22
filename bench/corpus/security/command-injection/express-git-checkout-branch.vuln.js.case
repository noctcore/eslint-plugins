// @bench category=command-injection cwe=CWE-78 framework=express pair=express-git-checkout-branch title="branch name from the query string interpolated into a git exec call"
const { exec } = require('node:child_process');
const express = require('express');

const router = express.Router();

router.post('/deploy/checkout', (req, res) => {
  const branch = req.query.branch;
  const repoDir = '/srv/acme/app';
  exec(`git -C ${repoDir} checkout ${branch}`, (error, stdout) => { // expect: security/no-shell-interpolation
    if (error) {
      return res.status(500).json({ error: 'checkout failed' });
    }
    res.json({ output: stdout.trim() });
  });
});

module.exports = router;
