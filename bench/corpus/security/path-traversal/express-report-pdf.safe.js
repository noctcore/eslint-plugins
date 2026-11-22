// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-report-pdf title="anchored regex limits the report name to a flat pdf file name"
// ok
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, 'reports');
const app = express();

app.get('/reports/:name', (req, res) => {
  const { name } = req.params;
  if (!/^[\w-]+\.pdf$/.test(name)) {
    return res.status(400).send('bad report name');
  }
  const full = path.resolve(ROOT, name);
  res.download(full);
});

app.listen(8080, () => {
  console.log('reports service up');
});
