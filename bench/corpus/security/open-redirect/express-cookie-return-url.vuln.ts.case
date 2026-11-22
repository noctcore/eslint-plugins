// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-cookie-return-url title="redirect target read back from a client-set cookie"
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';

const app = express();
app.use(cookieParser());

const APP_ORIGIN = 'https://app.example.com';

app.get('/auth/finish', (req: Request, res: Response) => {
  req.session.finished = true;
  res.clearCookie('flash');
  res.redirect(req.cookies.returnTo ?? '/'); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
