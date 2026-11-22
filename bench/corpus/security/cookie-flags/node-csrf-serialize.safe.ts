// @bench category=cookie-flags cwe=CWE-1004 framework=node pair=node-csrf-serialize title="cookie package serializes a client readable csrf token"
// ok
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { serialize } from 'cookie';
import { signJwt } from './jwt';

createServer(async (req, res) => {
  const jwt: string = await signJwt({ sub: 'user-1' });
  const csrf: string = randomBytes(24).toString('hex');
  const header = serialize('csrf_token', csrf, { path: '/', sameSite: 'lax', secure: true });
  res.setHeader('Set-Cookie', header);
  res.statusCode = 204;
  res.end();
}).listen(3000);
