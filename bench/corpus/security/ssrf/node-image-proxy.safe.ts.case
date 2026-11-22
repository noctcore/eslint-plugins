// @bench category=ssrf cwe=CWE-918 framework=node pair=node-image-proxy title="src parsed with new URL and hostname looked up in a Set of CDN hosts"
// ok
import * as http from 'node:http';
import * as https from 'node:https';

const CDN_HOSTS = new Set(['img.example.com', 'cdn.example.com']);

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url ?? '/', 'http://localhost');
  const src = new URL(incoming.searchParams.get('src') ?? '');
  if (src.protocol !== 'https:' || !CDN_HOSTS.has(src.hostname)) {
    res.writeHead(403).end();
    return;
  }
  https.get(src, (upstream) => {
    res.writeHead(upstream.statusCode ?? 502, {
      'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
    });
    upstream.pipe(res);
  }).on('error', () => {
    res.writeHead(502).end();
  });
});

server.listen(3000);
