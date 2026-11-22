// @bench category=ssrf cwe=CWE-918 framework=node pair=node-api-passthrough title="passthrough appends the raw request path to the API origin"
import * as http from 'node:http';

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url ?? '/', 'http://localhost');
  const path = incoming.searchParams.get('path') ?? '';
  const upstream = await fetch(`https://api.example.com${path}`); // expect: security/no-user-controlled-fetch-url
  const text = await upstream.text();
  res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
  res.end(text);
});

server.listen(3000);
