// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-cookie-return-ts title="writeHead 302 to the return_to value read from the Cookie header"
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const APP_ORIGIN = 'https://app.example.com';

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const pair = (req.headers.cookie ?? '').split('; ').find((c) => c.startsWith(name + '='));
  return pair?.slice(name.length + 1);
}

function finish(req: IncomingMessage, res: ServerResponse): void {
  const returnTo = readCookie(req, 'return_to') ?? '/';
  res.writeHead(302, { Location: returnTo }); // expect: security/no-user-controlled-redirect
  res.end();
}

http.createServer(finish).listen(3000);
