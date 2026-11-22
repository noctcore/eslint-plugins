// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-decode-location-ts title="decoded to query value set as the Location header"
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PATH_RE = /^\/(?!\/)[a-z0-9/_-]*$/i;

function jump(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const decoded = decodeURIComponent(url.searchParams.get('to') ?? '/');
  res.statusCode = 302;
  res.setHeader('Location', decoded); // expect: security/no-user-controlled-redirect
  res.end();
}

http.createServer(jump).listen(3000);
