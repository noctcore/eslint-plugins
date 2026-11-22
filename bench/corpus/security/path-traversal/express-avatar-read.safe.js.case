// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-avatar-read title="basename of the query name taken before building the path"
// ok
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const UPLOADS = '/srv/app/uploads/avatars';
const app = express();

app.get('/avatar', (req, res) => {
  const name = req.query.name;
  const target = `${UPLOADS}/${path.basename(String(name))}`;
  fs.readFile(target, (err, data) => {
    if (err) {
      res.status(404).send('not found');
      return;
    }
    res.type('image/png').send(data);
  });
});

app.listen(3000);
