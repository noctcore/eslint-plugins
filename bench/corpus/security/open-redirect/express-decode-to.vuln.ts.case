// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-decode-to title="decoded to query value used as the redirect target"
import express, { Request, Response } from 'express';

const app = express();

function isLocalPath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\');
}

app.get('/continue', (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(decodeURIComponent(String(req.query.to))); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
