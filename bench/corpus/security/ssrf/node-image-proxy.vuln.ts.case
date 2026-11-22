// @bench category=ssrf cwe=CWE-918 framework=node pair=node-image-proxy title="image proxy pipes https.get on the src query value"
import * as http from 'node:http';
import * as https from 'node:https';

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url ?? '/', 'http://localhost');
  const src = incoming.searchParams.get('src') ?? '';
  https.get(src, (upstream) => { // expect: security/no-user-controlled-fetch-url
    res.writeHead(upstream.statusCode ?? 502, {
      'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
    });
    upstream.pipe(res);
  }).on('error', () => {
    res.writeHead(502).end();
  });
});

server.listen(3000);
