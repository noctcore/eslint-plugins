// @bench category=ssrf cwe=CWE-918 framework=express pair=express-new-url title="parsed target must be https and on the probe host allowlist"
// ok
const express = require('express');
const https = require('node:https');

const app = express();
app.use(express.json());
const PROBE_HOSTS = ['status.example.com', 'health.example.com'];

app.post('/probe', (req, res) => {
  const target = new URL(req.body.target);
  if (target.protocol !== 'https:' || !PROBE_HOSTS.includes(target.hostname)) {
    return res.status(400).json({ error: 'host not allowed' });
  }
  https.get(target, (upstream) => {
    res.json({ status: upstream.statusCode, server: upstream.headers.server });
    upstream.resume();
  }).on('error', () => res.status(502).json({ error: 'unreachable' }));
});

app.listen(3000);
