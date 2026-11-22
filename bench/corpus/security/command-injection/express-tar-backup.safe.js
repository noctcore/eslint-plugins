// @bench category=command-injection cwe=CWE-78 framework=express pair=express-tar-backup title="folder passed to tar as an argument array without a shell"
// ok
const express = require('express');
const { spawn } = require('node:child_process');

const app = express();

app.get('/backup', (req, res) => {
  const folder = req.query.folder;
  const args = ['-czf', `/var/backups/${folder}.tgz`, '-C', '/srv/data', '--', String(folder)];
  const child = spawn('tar', args);
  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'backup failed' });
    }
    res.json({ archive: `/var/backups/${folder}.tgz` });
  });
});

app.listen(3000);
