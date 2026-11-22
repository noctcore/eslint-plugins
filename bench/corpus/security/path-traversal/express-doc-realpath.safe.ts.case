// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-doc-realpath title="realpath of the joined file must stay under the realpath of the docs dir"
// ok
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const DOCS = path.resolve(__dirname, 'docs');
const app = express();

app.get('/docs/:page', async (req, res) => {
  const docsReal = await fs.promises.realpath(DOCS);
  const file = await fs.promises.realpath(path.join(DOCS, req.params.page));
  if (!file.startsWith(docsReal + path.sep)) {
    res.sendStatus(403);
    return;
  }
  const body = await fs.promises.readFile(file, 'utf8');
  res.type('text/markdown').send(body);
});

app.listen(3200);
