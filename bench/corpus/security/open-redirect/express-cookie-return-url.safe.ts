// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-cookie-return-url title="cookie value parsed and its origin compared to the app origin"
// ok
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';

const app = express();
app.use(cookieParser());

const APP_ORIGIN = 'https://app.example.com';

app.get('/auth/finish', (req: Request, res: Response) => {
  req.session.finished = true;
  res.clearCookie('flash');
  const url = new URL(String(req.cookies.returnTo ?? '/'), APP_ORIGIN);
  if (url.origin !== APP_ORIGIN) {
    return res.redirect('/');
  }
  res.redirect(url.pathname + url.search);
});

app.listen(3000);
