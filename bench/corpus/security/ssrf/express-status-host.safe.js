// @bench category=ssrf cwe=CWE-918 framework=express pair=express-status-host title="host query checked against a Set of tenant hosts before interpolation"
// ok
const express = require('express');

const app = express();
const TENANT_HOSTS = new Set(['alpha.tenants.example.com', 'beta.tenants.example.com']);

app.get('/tenants/status', async (req, res) => {
  const host = String(req.query.host);
  if (!TENANT_HOSTS.has(host)) {
    return res.status(400).json({ error: 'unknown tenant' });
  }
  try {
    const response = await fetch(`https://${host}/status`);
    const body = await response.json();
    res.json({ up: response.ok, version: body.version });
  } catch (err) {
    res.json({ up: false });
  }
});

app.listen(8080);
