// @bench category=cookie-flags cwe=CWE-1004 framework=node pair=node-serialize-httponly-false title="cookie package serialize with httpOnly true for access token"
// ok
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { serialize } from 'cookie';
import { exchangeCode } from './oauth';

async function callback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const code = new URL(req.url ?? '/', 'https://app.example.test').searchParams.get('code') ?? '';
  const access: string = await exchangeCode(code);
  const header = serialize('access_token', access, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 3600,
  });
  res.setHeader('Set-Cookie', header);
  res.statusCode = 302;
  res.end();
}

createServer(callback).listen(3000);
