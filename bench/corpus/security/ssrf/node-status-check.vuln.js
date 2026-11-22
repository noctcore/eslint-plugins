// @bench category=ssrf cwe=CWE-918 framework=node pair=node-status-check title="status check interpolates the host query into the request URL"
const http = require('node:http');

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  const host = incoming.searchParams.get('host');
  let up = false;
  try {
    const probe = await fetch(`https://${host}/ping`); // expect: security/no-user-controlled-fetch-url
    up = probe.ok;
  } catch {
    up = false;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ up }));
});

server.listen(3000);
