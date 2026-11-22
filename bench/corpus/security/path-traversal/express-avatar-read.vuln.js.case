// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-avatar-read title="query name interpolated into the avatars dir path and read"
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const UPLOADS = '/srv/app/uploads/avatars';
const app = express();

app.get('/avatar', (req, res) => {
  const name = req.query.name;
  const target = `${UPLOADS}/${name}`; // expect: security/require-path-containment
  fs.readFile(target, (err, data) => {
    if (err) {
      res.status(404).send('not found');
      return;
    }
    res.type('image/png').send(data);
  });
});

app.listen(3000);
