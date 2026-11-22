// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-invoice-download title="invoice name from the route joined onto the invoices dir"
const path = require('node:path');
const express = require('express');

const INVOICES = path.resolve(__dirname, 'invoices');
const router = express.Router();

router.get('/invoices/:name', (req, res) => {
  const file = path.join(INVOICES, req.params.name); // expect: security/require-path-containment
  res.sendFile(file);
});

router.get('/invoices', (_req, res) => {
  res.json({ hint: 'GET /invoices/:name' });
});

module.exports = router;
