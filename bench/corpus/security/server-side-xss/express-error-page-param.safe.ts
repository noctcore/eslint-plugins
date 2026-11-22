// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-error-page-param title="page param HTML-escaped with he.encode"
// ok
import express, { Request, Response } from 'express';
import he from 'he';

const app = express();
const known = new Set(['home', 'pricing', 'about']);

app.get('/pages/:page', (req: Request, res: Response) => {
  const page: string = req.params.page;
  if (known.has(page)) {
    res.send(`<main><h1>${page}</h1></main>`);
    return;
  }
  res.status(404);
  res.send(`<h1>Not found</h1><p>No page called "${he.encode(page)}" exists.</p>`);
});

app.listen(3000);
