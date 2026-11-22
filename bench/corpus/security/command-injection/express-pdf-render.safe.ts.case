// @bench category=command-injection cwe=CWE-78 framework=express pair=express-pdf-render title="report kind validated by zod enum, helper maps it into the command"
// ok
import express from 'express';
import { exec } from 'node:child_process';
import { z } from 'zod';

const app = express();
app.use(express.json());

const Body = z.object({ kind: z.enum(['daily', 'weekly', 'monthly']) });

function buildRenderCommand(kind: string): string {
  return `wkhtmltopdf --quiet https://reports.internal.example.com/${kind} /tmp/render.pdf`;
}

app.post('/reports/pdf', (req, res) => {
  const { kind } = Body.parse(req.body);
  exec(buildRenderCommand(kind), (error) => {
    if (error) {
      res.status(500).json({ error: 'render failed' });
      return;
    }
    res.sendFile('/tmp/render.pdf');
  });
});

app.listen(4000);
