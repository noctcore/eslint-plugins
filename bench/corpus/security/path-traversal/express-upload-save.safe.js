// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-upload-save title="stored name is a random uuid plus the extension, client name never used"
// ok
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');

const STORE = path.resolve('/var/data/store');
const app = express();
app.use(express.json({ limit: '5mb' }));

app.post('/files', async (req, res) => {
  const { filename, content } = req.body;
  const dest = path.join(STORE, `${randomUUID()}${path.extname(String(filename))}`);
  await fs.promises.writeFile(dest, Buffer.from(content, 'base64'));
  res.status(201).json({ stored: path.basename(dest) });
});

app.listen(4000);
