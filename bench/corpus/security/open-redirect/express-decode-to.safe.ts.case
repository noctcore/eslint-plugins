// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-decode-to title="decoded value must be a plain local path before redirect"
// ok
import express, { Request, Response } from 'express';

const app = express();

function isLocalPath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\');
}

app.get('/continue', (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const decoded = decodeURIComponent(String(req.query.to));
  const target = isLocalPath(decoded) ? decoded : '/';
  res.redirect(target);
});

app.listen(3000);
