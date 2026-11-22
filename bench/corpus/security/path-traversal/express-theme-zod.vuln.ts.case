// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-theme-zod title="body theme name resolved into a css path under the themes dir"
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';

const THEMES = path.resolve(__dirname, 'themes');
const app = express();
app.use(express.json());

app.post('/themes/load', async (req, res) => {
  const { theme } = req.body as { theme: string };
  const cssPath = path.resolve(THEMES, `${theme}.css`); // expect: security/require-path-containment
  const css = await fs.readFile(cssPath, 'utf8');
  res.type('text/css').send(css);
});

app.listen(3100);
