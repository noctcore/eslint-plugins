// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-template-preview title="template param joined with a named join import and sent as a file"
const { join } = require('node:path');
const express = require('express');

const TEMPLATES = join(__dirname, 'views', 'emails');
const router = express.Router();

router.get('/preview/:template', (req, res) => {
  const file = join(TEMPLATES, req.params.template); // expect: security/require-path-containment
  res.sendFile(file);
});

router.get('/preview', (_req, res) => {
  res.send('pick a template');
});

module.exports = router;
