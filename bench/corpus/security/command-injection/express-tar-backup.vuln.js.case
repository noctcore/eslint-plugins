// @bench category=command-injection cwe=CWE-78 framework=express pair=express-tar-backup title="folder from the query built into a command string run with sh -c"
const express = require('express');
const { spawn } = require('node:child_process');

const app = express();

app.get('/backup', (req, res) => {
  const folder = req.query.folder;
  const cmd = `tar -czf /var/backups/${folder}.tgz /srv/data/${folder}`;
  const child = spawn('sh', ['-c', cmd]); // expect: security/no-shell-interpolation
  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'backup failed' });
    }
    res.json({ archive: `/var/backups/${folder}.tgz` });
  });
});

app.listen(3000);
