// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-search-echo title="query HTML-escaped before it is echoed"
// ok
const express = require('express');
const { searchProducts } = require('./catalog');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const router = express.Router();

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const results = await searchProducts(q);
  res.type('html');
  res.send(`<h1>Results for ${escapeHtml(q)}</h1><p>${results.length} products</p>`);
});

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
