// @bench category=command-injection cwe=CWE-78 framework=node pair=node-http-curl-health title="x-target header parsed as a URL and host checked with Set.has before execSync"
// ok
const http = require('node:http');
const { execSync } = require('node:child_process');

const HOSTS = new Set(['api.example.com', 'www.example.com']);

const server = http.createServer((req, res) => {
  let target;
  try {
    const parsed = new URL(String(req.headers['x-target']));
    if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) throw new Error('blocked');
    target = `https://${parsed.hostname}/health`;
  } catch (err) {
    res.writeHead(400);
    res.end('target not allowed');
    return;
  }
  try {
    const status = execSync('curl -s -o /dev/null -w "%{http_code}" ' + target, { encoding: 'utf8' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ target, status }));
  } catch (err) {
    res.writeHead(502);
    res.end('probe failed');
  }
});

server.listen(8081);
