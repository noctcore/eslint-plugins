// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-error-write title="error page streams the request path with res.write"
import http, { IncomingMessage, ServerResponse } from 'node:http';

const routes = new Set(['/', '/status']);

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '/').split('?')[0];
  if (routes.has(path)) {
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.write('<html><body><h1>Missing</h1>');
  res.write(`<p>The path ${path} does not exist.</p>`); // expect: security/require-sanitized-html
  res.end('</body></html>');
}

http.createServer(handle).listen(5001);
