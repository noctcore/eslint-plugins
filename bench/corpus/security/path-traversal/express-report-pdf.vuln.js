// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-report-pdf title="report name from the route resolved under the reports root and downloaded"
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, 'reports');
const app = express();

app.get('/reports/:name', (req, res) => {
  const { name } = req.params;
  const full = path.resolve(ROOT, name); // expect: security/require-path-containment
  res.download(full);
});

app.listen(8080, () => {
  console.log('reports service up');
});
