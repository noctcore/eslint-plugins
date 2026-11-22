// @bench category=command-injection cwe=CWE-78 framework=express pair=express-pdf-render title="url from the body flows through a command builder helper into exec"
import express from 'express';
import { exec } from 'node:child_process';

const app = express();
app.use(express.json());

function buildRenderCommand(source: string): string {
  return `wkhtmltopdf --quiet ${source} /tmp/render.pdf`;
}

app.post('/reports/pdf', (req, res) => {
  const source: string = req.body.url;
  exec(buildRenderCommand(source), (error) => { // expect: security/no-shell-interpolation
    if (error) {
      res.status(500).json({ error: 'render failed' });
      return;
    }
    res.sendFile('/tmp/render.pdf');
  });
});

app.listen(4000);
