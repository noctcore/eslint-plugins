// @bench category=ssrf cwe=CWE-918 framework=node pair=node-link-preview title="http server fetches the url query parameter"
const http = require('node:http');

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  if (incoming.pathname !== '/preview') {
    res.writeHead(404).end();
    return;
  }
  const target = incoming.searchParams.get('url');
  const upstream = await fetch(target); // expect: security/no-user-controlled-fetch-url
  const html = await upstream.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ title }));
});

server.listen(3000);
