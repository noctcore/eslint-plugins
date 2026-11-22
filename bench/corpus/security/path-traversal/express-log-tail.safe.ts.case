// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-log-tail title="relative path from the log dir checked for dotdot and absolute"
// ok
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response } from 'express';

const LOG_DIR = path.resolve('/var/log/myapp');
const app = express();

app.get('/logs', (req: Request, res: Response) => {
  const file = String(req.query.file ?? 'app.log');
  const full = path.resolve(LOG_DIR, file);
  const rel = path.relative(LOG_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(403).end();
    return;
  }
  fs.createReadStream(full).pipe(res);
});

app.listen(9000);

export default app;
