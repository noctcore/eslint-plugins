// @bench category=command-injection cwe=CWE-78 framework=express pair=express-convert-image title="file name checked against an allowlist array before the promisified exec"
// ok
const express = require('express');
const { promisify } = require('node:util');
const { exec } = require('node:child_process');

const run = promisify(exec);
const app = express();
app.use(express.json());

const SAMPLE_FILES = ['logo.png', 'banner.png', 'avatar.png'];

app.post('/images/convert', async (req, res) => {
  const { file } = req.body;
  if (!SAMPLE_FILES.includes(file)) {
    return res.status(400).json({ error: 'unknown file' });
  }
  try {
    const { stdout } = await run(`convert /uploads/${file} -resize 50% /thumbs/${file}.png`);
    res.json({ ok: true, log: stdout });
  } catch (err) {
    res.status(500).json({ error: 'conversion failed' });
  }
});

app.listen(8080);
