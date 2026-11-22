// @bench category=ssrf cwe=CWE-918 framework=node pair=node-api-passthrough title="fixed origin with only an encoded resource id from the user"
// ok
import * as http from 'node:http';

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url ?? '/', 'http://localhost');
  const id = encodeURIComponent(incoming.searchParams.get('id') ?? '');
  const upstream = await fetch(`https://api.example.com/v1/resources/${id}`);
  const text = await upstream.text();
  res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
  res.end(text);
});

server.listen(3000);
