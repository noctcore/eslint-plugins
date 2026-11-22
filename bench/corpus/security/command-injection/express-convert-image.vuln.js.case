// @bench category=command-injection cwe=CWE-78 framework=express pair=express-convert-image title="uploaded file name from the body interpolated into a promisified exec"
const express = require('express');
const { promisify } = require('node:util');
const { exec } = require('node:child_process');

const run = promisify(exec);
const app = express();
app.use(express.json());

app.post('/images/convert', async (req, res) => {
  const { file } = req.body;
  try {
    const { stdout } = await run(`convert /uploads/${file} -resize 50% /thumbs/${file}.png`); // expect: security/no-shell-interpolation
    res.json({ ok: true, log: stdout });
  } catch (err) {
    res.status(500).json({ error: 'conversion failed' });
  }
});

app.listen(8080);
