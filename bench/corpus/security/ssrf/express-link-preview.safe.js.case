// @bench category=ssrf cwe=CWE-918 framework=express pair=express-link-preview title="posted URL parsed and its hostname checked against an allowlist"
// ok
const express = require('express');

const router = express.Router();
const ALLOWED_HOSTS = ['news.example.com', 'blog.example.com'];

router.post('/preview', async (req, res) => {
  const url = new URL(req.body.url);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
    return res.status(400).json({ error: 'host not allowed' });
  }
  const response = await fetch(url);
  const html = await response.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  res.json({ title });
});

module.exports = router;
