// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-host-concat-path title="path query value appended directly after the app host in Location"
const http = require('node:http');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path') || '/';
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', 'https://app.example.com' + path); // expect: security/no-user-controlled-redirect
  res.end();
});

server.listen(3000);
