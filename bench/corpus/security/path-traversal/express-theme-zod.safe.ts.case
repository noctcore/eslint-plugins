// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-theme-zod title="zod schema restricts the theme to lowercase slug characters"
// ok
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';

const THEMES = path.resolve(__dirname, 'themes');
const app = express();
app.use(express.json());

app.post('/themes/load', async (req, res) => {
  const schema = z.object({ theme: z.string().regex(/^[a-z0-9-]{1,32}$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  const cssPath = path.resolve(THEMES, `${parsed.data.theme}.css`);
  const css = await fs.readFile(cssPath, 'utf8');
  res.type('text/css').send(css);
});

app.listen(3100);
