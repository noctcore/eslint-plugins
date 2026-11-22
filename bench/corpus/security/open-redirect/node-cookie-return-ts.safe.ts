// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-cookie-return-ts title="cookie value parsed and its origin compared to the app origin"
// ok
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const APP_ORIGIN = 'https://app.example.com';

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const pair = (req.headers.cookie ?? '').split('; ').find((c) => c.startsWith(name + '='));
  return pair?.slice(name.length + 1);
}

function finish(req: IncomingMessage, res: ServerResponse): void {
  const returnTo = readCookie(req, 'return_to') ?? '/';
  const url = new URL(returnTo, APP_ORIGIN);
  const target = url.origin === APP_ORIGIN ? url.pathname + url.search : '/';
  res.writeHead(302, { Location: target });
  res.end();
}

http.createServer(finish).listen(3000);
