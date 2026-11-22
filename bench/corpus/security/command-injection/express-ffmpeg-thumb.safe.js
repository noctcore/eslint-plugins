// @bench category=command-injection cwe=CWE-78 framework=express pair=express-ffmpeg-thumb title="input path passed as spawnSync argument array without a shell"
// ok
const express = require('express');
const { spawnSync } = require('node:child_process');

const app = express();
app.use(express.json());

app.post('/video/thumbnail', (req, res) => {
  const input = req.body.input;
  const result = spawnSync('ffmpeg', ['-y', '-i', input, '-frames:v', '1', '/tmp/thumb.png']);
  if (result.status !== 0) {
    return res.status(500).json({ error: 'ffmpeg failed' });
  }
  res.sendFile('/tmp/thumb.png');
});

app.listen(3000);
