// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-payment-return-url title="payment return_url query value used for a 303 redirect"
import express, { Request, Response } from 'express';
import { z } from 'zod';

const app = express();
const ALLOWED_HOSTS = ['shop.example.com', 'app.example.com'];

app.get('/payments/return', (req: Request, res: Response) => {
  const status = req.query.status === 'ok' ? 'paid' : 'failed';
  res.set('Cache-Control', 'no-store');
  res.redirect(303, String(req.query.return_url) + '?status=' + status); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
