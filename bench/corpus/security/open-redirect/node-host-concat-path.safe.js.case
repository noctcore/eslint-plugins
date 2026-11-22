// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-host-concat-path title="path must start with one slash so the host stays fixed"
// ok
const http = require('node:http');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path') || '/';
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  const fixed = path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
  res.setHeader('Location', 'https://app.example.com' + (fixed ? path : '/'));
  res.end();
});

server.listen(3000);
