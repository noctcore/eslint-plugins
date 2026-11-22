// @bench category=command-injection cwe=CWE-78 framework=express pair=express-dns-lookup title="domain route param interpolated into execSync nslookup"
import express from 'express';
import { execSync } from 'node:child_process';

const router = express.Router();

router.get('/dns/:domain', (req, res) => {
  const domain = req.params.domain;
  try {
    const output = execSync(`nslookup ${domain}`, { encoding: 'utf8' }); // expect: security/no-shell-interpolation
    res.type('text/plain').send(output);
  } catch {
    res.status(404).send('lookup failed');
  }
});

export default router;
