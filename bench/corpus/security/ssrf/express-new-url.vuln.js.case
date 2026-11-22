// @bench category=ssrf cwe=CWE-918 framework=express pair=express-new-url title="https.get receives a URL object built from the target body field"
const express = require('express');
const https = require('node:https');

const app = express();
app.use(express.json());

app.post('/probe', (req, res) => {
  const target = new URL(req.body.target);
  https.get(target, (upstream) => { // expect: security/no-user-controlled-fetch-url
    res.json({ status: upstream.statusCode, server: upstream.headers.server });
    upstream.resume();
  }).on('error', () => res.status(502).json({ error: 'unreachable' }));
});

app.listen(3000);
