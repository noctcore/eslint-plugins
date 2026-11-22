// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-invoice-download title="resolved path checked to stay under the invoices dir"
// ok
const path = require('node:path');
const express = require('express');

const INVOICES = path.resolve(__dirname, 'invoices');
const router = express.Router();

router.get('/invoices/:name', (req, res) => {
  const file = path.resolve(INVOICES, req.params.name);
  if (!file.startsWith(INVOICES + path.sep)) {
    return res.sendStatus(403);
  }
  res.sendFile(file);
});

router.get('/invoices', (_req, res) => {
  res.json({ hint: 'GET /invoices/:name' });
});

module.exports = router;
