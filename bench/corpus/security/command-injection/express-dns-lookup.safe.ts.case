// @bench category=command-injection cwe=CWE-78 framework=express pair=express-dns-lookup title="domain validated by an anchored hostname regex before execSync"
// ok
import express from 'express';
import { execSync } from 'node:child_process';

const router = express.Router();
const HOSTNAME = /^(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i;

router.get('/dns/:domain', (req, res) => {
  const domain = req.params.domain;
  if (!HOSTNAME.test(domain)) {
    res.status(400).send('invalid domain');
    return;
  }
  try {
    const output = execSync(`nslookup ${domain}`, { encoding: 'utf8' });
    res.type('text/plain').send(output);
  } catch {
    res.status(404).send('lookup failed');
  }
});

export default router;
