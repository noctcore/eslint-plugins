// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-error-write title="request path encoded with he.encode before res.write"
// ok
import http, { IncomingMessage, ServerResponse } from 'node:http';
import he from 'he';

const routes = new Set(['/', '/status']);

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '/').split('?')[0];
  if (routes.has(path)) {
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.write('<html><body><h1>Missing</h1>');
  res.write(`<p>The path ${he.encode(path)} does not exist.</p>`);
  res.end('</body></html>');
}

http.createServer(handle).listen(5001);
