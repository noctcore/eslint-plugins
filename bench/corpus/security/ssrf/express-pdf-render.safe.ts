// @bench category=ssrf cwe=CWE-918 framework=express pair=express-pdf-render title="page URL allowlisted by hostname and resolved address checked for private ranges"
// ok
import express, { Request, Response } from 'express';
import axios from 'axios';
import { lookup } from 'node:dns/promises';

const app = express();
app.use(express.json());
const REPORT_HOSTS = ['reports.example.com', 'docs.example.com'];

function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1';
}

app.post('/pdf', async (req: Request, res: Response) => {
  const page = new URL(req.body.page as string);
  if (page.protocol !== 'https:' || !REPORT_HOSTS.includes(page.hostname)) {
    return res.status(400).end();
  }
  const { address } = await lookup(page.hostname);
  if (isPrivate(address)) return res.status(400).end();
  const source = await axios({ url: page.href, method: 'get', timeout: 8000 });
  res.type('application/pdf').send(Buffer.from(source.data));
});

app.listen(3000);
