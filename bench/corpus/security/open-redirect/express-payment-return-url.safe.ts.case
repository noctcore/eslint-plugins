// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-payment-return-url title="return_url validated by zod against an https host allowlist"
// ok
import express, { Request, Response } from 'express';
import { z } from 'zod';

const app = express();
const ALLOWED_HOSTS = ['shop.example.com', 'app.example.com'];

app.get('/payments/return', (req: Request, res: Response) => {
  const status = req.query.status === 'ok' ? 'paid' : 'failed';
  res.set('Cache-Control', 'no-store');
  const ReturnUrl = z
    .string()
    .url()
    .refine((u) => u.startsWith('https://') && ALLOWED_HOSTS.includes(new URL(u).hostname));
  const parsed = ReturnUrl.safeParse(req.query.return_url);
  if (!parsed.success) return res.status(400).send('bad return url');
  res.redirect(303, parsed.data + '?status=' + status);
});

app.listen(3000);
