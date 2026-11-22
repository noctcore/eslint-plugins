// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-search-echo title="search page echoes the raw query into HTML"
const express = require('express');
const { searchProducts } = require('./catalog');

const router = express.Router();

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const results = await searchProducts(q);
  res.type('html');
  res.send(`<h1>Results for ${q}</h1><p>${results.length} products</p>`); // expect: security/require-sanitized-html
});

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
