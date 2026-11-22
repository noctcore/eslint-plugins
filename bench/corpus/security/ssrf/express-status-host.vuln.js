// @bench category=ssrf cwe=CWE-918 framework=express pair=express-status-host title="status check interpolates the host query parameter into the URL"
const express = require('express');

const app = express();

app.get('/tenants/status', async (req, res) => {
  const host = req.query.host;
  try {
    const response = await fetch(`https://${host}/status`); // expect: security/no-user-controlled-fetch-url
    const body = await response.json();
    res.json({ up: response.ok, version: body.version });
  } catch (err) {
    res.json({ up: false });
  }
});

app.listen(8080);
