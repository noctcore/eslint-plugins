// @bench category=ssrf cwe=CWE-918 framework=express pair=express-link-preview title="link preview fetches whatever URL the client posts"
const express = require('express');

const router = express.Router();

router.post('/preview', async (req, res) => {
  const target = req.body.url;
  const response = await fetch(target); // expect: security/no-user-controlled-fetch-url
  const html = await response.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  res.json({ title });
});

module.exports = router;
