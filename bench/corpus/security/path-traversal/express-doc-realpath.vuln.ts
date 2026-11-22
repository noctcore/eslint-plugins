// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-doc-realpath title="doc page param joined onto the docs dir and read as text"
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const DOCS = path.resolve(__dirname, 'docs');
const app = express();

app.get('/docs/:page', async (req, res) => {
  const file = path.join(DOCS, req.params.page); // expect: security/require-path-containment
  const body = await fs.promises.readFile(file, 'utf8');
  res.type('text/markdown').send(body);
});

app.listen(3200);
