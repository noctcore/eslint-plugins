// @bench category=ssrf cwe=CWE-918 framework=node pair=node-status-check title="host query checked against a Set of known hosts before interpolation"
// ok
const http = require('node:http');

const KNOWN_HOSTS = new Set(['api.example.com', 'auth.example.com']);

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  const host = incoming.searchParams.get('host') ?? '';
  if (!KNOWN_HOSTS.has(host)) {
    res.writeHead(400).end();
    return;
  }
  let up = false;
  try {
    const probe = await fetch(`https://${host}/ping`);
    up = probe.ok;
  } catch {
    up = false;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ up }));
});

server.listen(3000);
