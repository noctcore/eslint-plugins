// @bench category=ssrf cwe=CWE-918 framework=node pair=node-link-preview title="url query parsed and hostname checked against an allowlist"
// ok
const http = require('node:http');

const ALLOWED_HOSTS = ['news.example.com', 'blog.example.com'];

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  if (incoming.pathname !== '/preview') {
    res.writeHead(404).end();
    return;
  }
  const target = new URL(incoming.searchParams.get('url') ?? '');
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname)) {
    res.writeHead(400).end();
    return;
  }
  const upstream = await fetch(target);
  const html = await upstream.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ title }));
});

server.listen(3000);
